import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import Income from '../models/Income.js';
import Sale from '../models/Sale.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { canAccessWorkspacePage } from '../constants/workspacePermissions.js';

function assertClientsReadAccess(req) {
  const scope = req.dataScope;
  if (!scope || scope.mode !== 'workspace') {
    return true;
  }
  const role = scope.role;
  const permissions = scope.permissions;
  if (
    canAccessWorkspacePage(role, permissions, 'finance') ||
    canAccessWorkspacePage(role, permissions, 'sales')
  ) {
    return true;
  }
  const error = new Error('You do not have access to customers in this workspace');
  error.statusCode = 403;
  throw error;
}

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function richnessScore(client) {
  let score = 0;
  if (client.email) score += 2;
  if (client.phone) score += 2;
  if (client.notes) score += 1;
  if (client.businessType && client.businessType !== 'General') score += 1;
  return score;
}

export const getClients = async (req, res) => {
  try {
    // Sales page needs customer picker; finance owns full CRM.
    assertClientsReadAccess(req);
    const clients = await Client.find(buildListQuery(req)).sort({ createdAt: -1 });
    res.json({ data: clients });
  } catch (error) {
    console.error('Error fetching clients:', error);
    handleScopeError(res, error);
  }
};

export const getClient = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const client = await Client.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ data: client });
  } catch (error) {
    console.error('Error fetching client:', error);
    handleScopeError(res, error);
  }
};

export const createClient = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { name, email, phone, businessType, clientType, notes, workerStatus, discipline, lastCheckIn, lastCheckOut } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const client = new Client({
      name: name.trim(),
      email: email ? email.trim().toLowerCase() : undefined,
      phone: phone ? phone.trim() : undefined,
      businessType: businessType ? businessType.trim() : 'General',
      clientType: clientType || 'other',
      notes: notes ? notes.trim() : undefined,
      workerStatus: workerStatus || 'active',
      discipline: discipline || 'good',
      lastCheckIn: lastCheckIn ? new Date(lastCheckIn) : undefined,
      lastCheckOut: lastCheckOut ? new Date(lastCheckOut) : undefined,
      ...buildCreateScope(req),
    });

    await client.save();
    res.status(201).json({ data: client });
  } catch (error) {
    console.error('Error creating client:', error);
    if (error.code === 11000) {
      res.status(400).json({ error: 'Client with this email already exists' });
    } else {
      handleScopeError(res, error);
    }
  }
};

export const updateClient = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { name, email, phone, businessType, clientType, notes, workerStatus, discipline, lastCheckIn, lastCheckOut } = req.body;

    const client = await Client.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (name !== undefined) client.name = name.trim();
    if (email !== undefined) {
      const normalizedEmail = email ? email.trim() : '';
      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }
      client.email = normalizedEmail ? normalizedEmail.toLowerCase() : undefined;
    }
    if (phone !== undefined) client.phone = phone ? phone.trim() : undefined;
    if (businessType !== undefined) {
      client.businessType = businessType ? businessType.trim() : 'General';
    }
    if (clientType !== undefined) client.clientType = clientType;
    if (notes !== undefined) client.notes = notes ? notes.trim() : undefined;
    if (workerStatus !== undefined) client.workerStatus = workerStatus;
    if (discipline !== undefined) client.discipline = discipline;
    if (lastCheckIn !== undefined) {
      client.lastCheckIn = lastCheckIn ? new Date(lastCheckIn) : undefined;
    }
    if (lastCheckOut !== undefined) {
      client.lastCheckOut = lastCheckOut ? new Date(lastCheckOut) : undefined;
    }

    await client.save();
    res.json({ data: client });
  } catch (error) {
    console.error('Error updating client:', error);
    handleScopeError(res, error);
  }
};

export const deleteClient = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const client = await Client.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Error deleting client:', error);
    handleScopeError(res, error);
  }
};

export const getClientActivity = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const client = await Client.findOne({ ...scope, _id: req.params.id });
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const [invoices, incomes] = await Promise.all([
      Invoice.find({ ...scope, clientId: client._id }).sort({ issueDate: -1 }).lean(),
      Income.find({ ...scope, clientId: client._id }).sort({ date: -1 }).lean(),
    ]);

    const outstanding = invoices
      .filter((inv) => inv.status === 'sent' || inv.status === 'overdue')
      .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

    const totalPaid = incomes.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

    res.json({
      data: {
        client,
        invoices,
        incomes,
        outstanding,
        totalPaid,
      },
    });
  } catch (error) {
    console.error('Error fetching client activity:', error);
    handleScopeError(res, error);
  }
};

/**
 * Merge customers that share the same normalized name into a single record.
 * Keeps the richest/oldest profile and reassigns sales, invoices, and incomes.
 */
export const mergeDuplicateClients = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const clients = await Client.find(scope).sort({ createdAt: 1 }).lean();

    const groups = new Map();
    for (const client of clients) {
      if (client.clientType === 'worker') continue;
      const key = normalizeName(client.name);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(client);
    }

    let mergedGroups = 0;
    let removedCount = 0;

    for (const group of groups.values()) {
      if (group.length < 2) continue;

      const keep = [...group].sort((a, b) => {
        const scoreDiff = richnessScore(b) - richnessScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })[0];

      const mergeIds = group
        .map((c) => c._id)
        .filter((id) => String(id) !== String(keep._id));

      if (!mergeIds.length) continue;

      // Fill missing contact fields on the keeper from duplicates.
      const keepDoc = await Client.findOne({ ...scope, _id: keep._id });
      if (!keepDoc) continue;

      for (const dup of group) {
        if (String(dup._id) === String(keep._id)) continue;
        if (!keepDoc.email && dup.email) keepDoc.email = dup.email;
        if (!keepDoc.phone && dup.phone) keepDoc.phone = dup.phone;
        if (!keepDoc.notes && dup.notes) keepDoc.notes = dup.notes;
        if (
          (!keepDoc.businessType || keepDoc.businessType === 'General') &&
          dup.businessType
        ) {
          keepDoc.businessType = dup.businessType;
        }
      }
      await keepDoc.save();

      await Promise.all([
        Sale.updateMany({ ...scope, clientId: { $in: mergeIds } }, { $set: { clientId: keep._id } }),
        Invoice.updateMany(
          { ...scope, clientId: { $in: mergeIds } },
          {
            $set: {
              clientId: keep._id,
              clientName: keepDoc.name,
              clientEmail: keepDoc.email || undefined,
              clientPhone: keepDoc.phone || undefined,
            },
          },
        ),
        Income.updateMany({ ...scope, clientId: { $in: mergeIds } }, { $set: { clientId: keep._id } }),
      ]);

      await Client.deleteMany({ ...scope, _id: { $in: mergeIds } });
      mergedGroups += 1;
      removedCount += mergeIds.length;
    }

    res.json({
      data: {
        mergedGroups,
        removedCount,
      },
      message:
        removedCount > 0
          ? `Merged ${removedCount} duplicate customer(s) into ${mergedGroups} profile(s).`
          : 'No duplicate customers found.',
    });
  } catch (error) {
    console.error('Error merging duplicate clients:', error);
    handleScopeError(res, error);
  }
};
