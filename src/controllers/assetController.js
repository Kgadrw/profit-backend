import Asset from '../models/Asset.js';
import TeamMember from '../models/TeamMember.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { buildDepreciationSchedule, computeDepreciatedValue } from '../utils/assetDepreciation.js';

const normalizeAssetDate = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

const applyComputedValue = (asset) => {
  if (asset.status === 'retired' || asset.status === 'disposed') {
    return;
  }
  asset.currentValue = computeDepreciatedValue(asset);
};

function actorFromRequest(req) {
  return {
    actorUserId: req.user?._id,
    actorName: req.user?.name || 'User',
  };
}

function pushLifecycleEvent(asset, eventType, summary, details, req) {
  asset.lifecycleEvents = asset.lifecycleEvents || [];
  asset.lifecycleEvents.unshift({
    eventType,
    summary,
    details,
    ...actorFromRequest(req),
    occurredAt: new Date(),
  });
  if (asset.lifecycleEvents.length > 100) {
    asset.lifecycleEvents = asset.lifecycleEvents.slice(0, 100);
  }
}

async function resolveCustodian(req, teamMemberId, assignedTo) {
  if (teamMemberId) {
    const member = await TeamMember.findOne(buildListQuery(req, { _id: teamMemberId }));
    if (member) {
      return { teamMemberId: member._id, assignedTo: member.name };
    }
  }
  return {
    teamMemberId: null,
    assignedTo: assignedTo ? String(assignedTo).trim() : undefined,
  };
}

async function nextAssetTag(req) {
  const count = await Asset.countDocuments(buildListQuery(req));
  return String(count + 1).padStart(3, '0');
}

function syncMaintenanceStatuses(asset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const record of asset.maintenanceRecords || []) {
    if (record.status === 'scheduled') {
      const scheduled = new Date(record.scheduledDate);
      scheduled.setHours(0, 0, 0, 0);
      if (scheduled < today) record.status = 'overdue';
    }
  }
}

export const getAssets = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const { status } = req.query;
    const query = buildListQuery(req);
    if (['active', 'in_use', 'maintenance', 'retired', 'disposed'].includes(status)) {
      query.status = status;
    }

    const assets = await Asset.find(query)
      .populate('teamMemberId', 'name jobTitle department')
      .sort({ status: 1, purchaseDate: -1, createdAt: -1 });

    for (const asset of assets) {
      syncMaintenanceStatuses(asset);
      applyComputedValue(asset);
    }

    res.json({ data: assets });
  } catch (error) {
    console.error('Error fetching assets:', error);
    handleScopeError(res, error);
  }
};

export const getAsset = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const asset = await Asset.findOne(buildListQuery(req, { _id: req.params.id })).populate(
      'teamMemberId',
      'name jobTitle department email phone',
    );
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    syncMaintenanceStatuses(asset);
    applyComputedValue(asset);
    res.json({ data: asset });
  } catch (error) {
    console.error('Error fetching asset:', error);
    handleScopeError(res, error);
  }
};

export const getAssetProfile = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const asset = await Asset.findOne(buildListQuery(req, { _id: req.params.id })).populate(
      'teamMemberId',
      'name jobTitle department email phone',
    );
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    syncMaintenanceStatuses(asset);
    applyComputedValue(asset);

    const plain = asset.toObject();
    const depreciationSchedule = buildDepreciationSchedule(plain);
    const upcomingMaintenance = (plain.maintenanceRecords || [])
      .filter((row) => row.status === 'scheduled' || row.status === 'overdue')
      .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());

    res.json({
      data: {
        asset: plain,
        depreciationSchedule,
        upcomingMaintenance,
      },
    });
  } catch (error) {
    console.error('Error fetching asset profile:', error);
    handleScopeError(res, error);
  }
};

export const getAssetSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const assets = await Asset.find(buildListQuery(req)).lean();
    const activeStatuses = new Set(['active', 'in_use', 'maintenance']);
    const activeAssets = assets.filter((a) => activeStatuses.has(a.status));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const warrantyCutoff = new Date(today);
    warrantyCutoff.setDate(warrantyCutoff.getDate() + 30);

    const totalPurchaseValue = activeAssets.reduce((sum, a) => sum + (Number(a.purchaseCost) || 0), 0);
    const totalCurrentValue = activeAssets.reduce(
      (sum, a) => sum + computeDepreciatedValue(a),
      0,
    );
    const warrantyExpiringSoon = activeAssets.filter((a) => {
      if (!a.warrantyExpires) return false;
      const expiry = new Date(a.warrantyExpires);
      expiry.setHours(0, 0, 0, 0);
      return expiry >= today && expiry <= warrantyCutoff;
    });

    const maintenanceDueCount = activeAssets.reduce((sum, asset) => {
      const records = asset.maintenanceRecords || [];
      const due = records.filter((row) => {
        if (row.status === 'overdue') return true;
        if (row.status !== 'scheduled') return false;
        const scheduled = new Date(row.scheduledDate);
        scheduled.setHours(0, 0, 0, 0);
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() + 30);
        return scheduled >= today && scheduled <= cutoff;
      });
      return sum + due.length;
    }, 0);

    res.json({
      data: {
        totalCount: assets.length,
        activeCount: activeAssets.length,
        totalPurchaseValue,
        totalCurrentValue,
        warrantyExpiringCount: warrantyExpiringSoon.length,
        maintenanceDueCount,
        retiredCount: assets.filter((a) => a.status === 'retired').length,
        disposedCount: assets.filter((a) => a.status === 'disposed').length,
      },
    });
  } catch (error) {
    console.error('Error fetching asset summary:', error);
    handleScopeError(res, error);
  }
};

export const createAsset = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const {
      title,
      assetTag,
      assetType,
      manufacturer,
      model,
      serialNumber,
      purchaseDate,
      purchaseCost,
      assignedTo,
      teamMemberId,
      location,
      warrantyExpires,
      status,
      depreciationMethod,
      usefulLifeMonths,
      salvageValue,
      note,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: 'Asset title is required' });
    }
    if (purchaseCost === undefined || purchaseCost === null || Number(purchaseCost) < 0) {
      return res.status(400).json({ error: 'Valid purchase cost is required' });
    }
    if (!purchaseDate) {
      return res.status(400).json({ error: 'Purchase date is required' });
    }

    const custodian = await resolveCustodian(req, teamMemberId, assignedTo);
    const tag = assetTag?.trim() || (await nextAssetTag(req));

    const asset = new Asset({
      title: title.trim(),
      assetTag: tag,
      assetType: assetType || 'equipment',
      manufacturer: manufacturer?.trim() || undefined,
      model: model?.trim() || undefined,
      serialNumber: serialNumber ? serialNumber.trim() : undefined,
      purchaseDate: normalizeAssetDate(purchaseDate),
      purchaseCost: Number(purchaseCost),
      assignedTo: custodian.assignedTo,
      teamMemberId: custodian.teamMemberId,
      location: location ? location.trim() : undefined,
      warrantyExpires: warrantyExpires ? normalizeAssetDate(warrantyExpires) : undefined,
      status: status || 'active',
      depreciationMethod: depreciationMethod || 'straight_line',
      usefulLifeMonths: usefulLifeMonths !== undefined ? Number(usefulLifeMonths) : undefined,
      salvageValue: salvageValue !== undefined ? Number(salvageValue) : 0,
      note: note ? note.trim() : undefined,
      maintenanceRecords: [],
      custodyHistory: [],
      lifecycleEvents: [],
      ...buildCreateScope(req),
    });

    pushLifecycleEvent(asset, 'registered', `Asset registered: ${asset.title}`, `Tag #${tag}`, req);

    if (custodian.teamMemberId) {
      asset.custodyHistory.push({
        teamMemberId: custodian.teamMemberId,
        assigneeName: custodian.assignedTo,
        assignedAt: new Date(),
      });
      pushLifecycleEvent(
        asset,
        'assigned',
        `Assigned to ${custodian.assignedTo}`,
        undefined,
        req,
      );
    }

    applyComputedValue(asset);
    await asset.save();
    res.status(201).json({ data: asset });
  } catch (error) {
    console.error('Error creating asset:', error);
    handleScopeError(res, error);
  }
};

export const updateAsset = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const asset = await Asset.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const previousStatus = asset.status;
    const previousTeamMemberId = asset.teamMemberId ? String(asset.teamMemberId) : null;

    const {
      title,
      assetTag,
      assetType,
      manufacturer,
      model,
      serialNumber,
      purchaseDate,
      purchaseCost,
      currentValue,
      assignedTo,
      teamMemberId,
      location,
      warrantyExpires,
      status,
      depreciationMethod,
      usefulLifeMonths,
      salvageValue,
      note,
    } = req.body;

    if (title !== undefined) asset.title = title.trim();
    if (assetTag !== undefined) asset.assetTag = assetTag ? assetTag.trim() : asset.assetTag;
    if (assetType !== undefined) asset.assetType = assetType || 'equipment';
    if (manufacturer !== undefined) asset.manufacturer = manufacturer ? manufacturer.trim() : undefined;
    if (model !== undefined) asset.model = model ? model.trim() : undefined;
    if (serialNumber !== undefined) asset.serialNumber = serialNumber ? serialNumber.trim() : undefined;
    if (purchaseDate !== undefined) asset.purchaseDate = normalizeAssetDate(purchaseDate);
    if (purchaseCost !== undefined) asset.purchaseCost = Number(purchaseCost);
    if (location !== undefined) asset.location = location ? location.trim() : undefined;
    if (warrantyExpires !== undefined) {
      asset.warrantyExpires = warrantyExpires ? normalizeAssetDate(warrantyExpires) : undefined;
    }
    if (status !== undefined) asset.status = status;
    if (depreciationMethod !== undefined) asset.depreciationMethod = depreciationMethod;
    if (usefulLifeMonths !== undefined) {
      asset.usefulLifeMonths = usefulLifeMonths !== null ? Number(usefulLifeMonths) : undefined;
    }
    if (salvageValue !== undefined) asset.salvageValue = Number(salvageValue) || 0;
    if (note !== undefined) asset.note = note ? note.trim() : undefined;

    if (assignedTo !== undefined || teamMemberId !== undefined) {
      const custodian = await resolveCustodian(req, teamMemberId ?? asset.teamMemberId, assignedTo ?? asset.assignedTo);
      const nextTeamMemberId = custodian.teamMemberId ? String(custodian.teamMemberId) : null;
      if (nextTeamMemberId !== previousTeamMemberId) {
        const openCustody = (asset.custodyHistory || []).find((row) => !row.returnedAt);
        if (openCustody) openCustody.returnedAt = new Date();

        if (custodian.teamMemberId) {
          asset.custodyHistory.push({
            teamMemberId: custodian.teamMemberId,
            assigneeName: custodian.assignedTo,
            assignedAt: new Date(),
          });
          pushLifecycleEvent(asset, 'assigned', `Assigned to ${custodian.assignedTo}`, undefined, req);
        } else if (previousTeamMemberId) {
          pushLifecycleEvent(asset, 'returned', 'Asset returned from custody', undefined, req);
        }
      }
      asset.teamMemberId = custodian.teamMemberId;
      asset.assignedTo = custodian.assignedTo;
    }

    if (status !== undefined && status !== previousStatus) {
      pushLifecycleEvent(
        asset,
        status === 'disposed' ? 'disposed' : 'status_change',
        `Status changed to ${status}`,
        undefined,
        req,
      );
    } else {
      pushLifecycleEvent(asset, 'updated', `Asset updated: ${asset.title}`, undefined, req);
    }

    if (currentValue !== undefined && (asset.status === 'retired' || asset.status === 'disposed')) {
      asset.currentValue = Number(currentValue);
    } else {
      applyComputedValue(asset);
    }

    await asset.save();
    res.json({ data: asset });
  } catch (error) {
    console.error('Error updating asset:', error);
    handleScopeError(res, error);
  }
};

export const assignAssetCustody = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const asset = await Asset.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const { teamMemberId, assignedTo, note } = req.body;
    const custodian = await resolveCustodian(req, teamMemberId, assignedTo);
    if (!custodian.teamMemberId && !custodian.assignedTo) {
      return res.status(400).json({ error: 'Assignee is required' });
    }

    const openCustody = (asset.custodyHistory || []).find((row) => !row.returnedAt);
    if (openCustody) openCustody.returnedAt = new Date();

    asset.teamMemberId = custodian.teamMemberId;
    asset.assignedTo = custodian.assignedTo;
    asset.custodyHistory.push({
      teamMemberId: custodian.teamMemberId,
      assigneeName: custodian.assignedTo,
      assignedAt: new Date(),
      note: note?.trim() || undefined,
    });
    if (asset.status === 'active') asset.status = 'in_use';

    pushLifecycleEvent(
      asset,
      'assigned',
      `Assigned to ${custodian.assignedTo}`,
      note?.trim() || undefined,
      req,
    );

    applyComputedValue(asset);
    await asset.save();
    res.json({ data: asset });
  } catch (error) {
    console.error('Error assigning asset custody:', error);
    handleScopeError(res, error);
  }
};

export const addAssetMaintenance = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const asset = await Asset.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const { title, scheduledDate, note, performedBy } = req.body;
    if (!title?.trim() || !scheduledDate) {
      return res.status(400).json({ error: 'Maintenance title and scheduled date are required' });
    }

    asset.maintenanceRecords.push({
      title: title.trim(),
      scheduledDate: normalizeAssetDate(scheduledDate),
      status: 'scheduled',
      note: note?.trim() || undefined,
      performedBy: performedBy?.trim() || undefined,
    });

    pushLifecycleEvent(
      asset,
      'maintenance',
      `Maintenance scheduled: ${title.trim()}`,
      note?.trim() || undefined,
      req,
    );

    await asset.save();
    res.status(201).json({ data: asset });
  } catch (error) {
    console.error('Error adding asset maintenance:', error);
    handleScopeError(res, error);
  }
};

export const completeAssetMaintenance = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const asset = await Asset.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const { maintenanceId, completedDate, note, performedBy } = req.body;
    const record = asset.maintenanceRecords.id(maintenanceId);
    if (!record) return res.status(404).json({ error: 'Maintenance record not found' });

    record.status = 'completed';
    record.completedDate = normalizeAssetDate(completedDate || new Date());
    if (note !== undefined) record.note = note?.trim() || undefined;
    if (performedBy !== undefined) record.performedBy = performedBy?.trim() || undefined;

    pushLifecycleEvent(
      asset,
      'maintenance',
      `Maintenance completed: ${record.title}`,
      note?.trim() || undefined,
      req,
    );

    if (asset.status === 'maintenance') asset.status = 'in_use';
    await asset.save();
    res.json({ data: asset });
  } catch (error) {
    console.error('Error completing asset maintenance:', error);
    handleScopeError(res, error);
  }
};

export const recordAssetAudit = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const asset = await Asset.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const { summary, details } = req.body;
    if (!summary?.trim()) {
      return res.status(400).json({ error: 'Audit summary is required' });
    }

    pushLifecycleEvent(asset, 'audit', summary.trim(), details?.trim() || undefined, req);
    await asset.save();
    res.json({ data: asset });
  } catch (error) {
    console.error('Error recording asset audit:', error);
    handleScopeError(res, error);
  }
};

export const deleteAsset = async (req, res) => {
  try {
    assertPageAccess(req, 'assets');
    const asset = await Asset.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    res.json({ message: 'Asset deleted' });
  } catch (error) {
    console.error('Error deleting asset:', error);
    handleScopeError(res, error);
  }
};

export { computeDepreciatedValue };
