import Client from '../models/Client.js';
import Deal from '../models/Deal.js';
import Quote from '../models/Quote.js';
import Contract from '../models/Contract.js';
import CrmActivity from '../models/CrmActivity.js';
import Invoice from '../models/Invoice.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const LIFECYCLE_STAGES = ['lead', 'prospect', 'customer', 'inactive'];
const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'terminated'];

function assertCrm(req) {
  assertPageAccess(req, 'crm');
}

function normalizeDate(value) {
  if (!value) return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`);
  }
  return new Date(value);
}

function computeLineItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items
    .map((row) => {
      const quantity = Number(row.quantity) || 0;
      const unitPrice = Number(row.unitPrice) || 0;
      const amount = row.amount !== undefined ? Number(row.amount) : quantity * unitPrice;
      return {
        description: String(row.description || '').trim(),
        quantity,
        unitPrice,
        amount: Math.max(0, amount),
      };
    })
    .filter((row) => row.description);
}

function sumLineItems(items) {
  return items.reduce((sum, row) => sum + (row.amount || 0), 0);
}

async function generateQuoteNumber(req) {
  const scope = buildListQuery(req);
  const year = new Date().getFullYear();
  const count = await Quote.countDocuments({
    ...scope,
    createdAt: {
      $gte: new Date(year, 0, 1),
      $lte: new Date(year, 11, 31, 23, 59, 59, 999),
    },
  });
  return `QUO-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function generateInvoiceNumber(userId) {
  const year = new Date().getFullYear();
  const count = await Invoice.countDocuments({
    userId,
    createdAt: {
      $gte: new Date(year, 0, 1),
      $lte: new Date(year, 11, 31, 23, 59, 59, 999),
    },
  });
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function syncClientSnapshot(req, clientId) {
  const client = await Client.findOne(buildListQuery(req, { _id: clientId }));
  if (!client) return null;
  return {
    clientId: client._id,
    clientName: client.name,
    clientEmail: client.email,
    clientPhone: client.phone,
  };
}

function actorFromRequest(req) {
  return {
    createdByUserId: req.user?._id,
    createdByName: req.user?.name || 'User',
  };
}

function applyClientCrmFields(client, body) {
  const fields = [
    'name',
    'email',
    'phone',
    'businessType',
    'notes',
    'lifecycleStage',
    'source',
    'companyName',
    'address',
    'ownerUserId',
    'tags',
  ];
  for (const field of fields) {
    if (body[field] === undefined) continue;
    if (field === 'email') {
      client.email = body.email ? String(body.email).trim().toLowerCase() : undefined;
    } else if (field === 'lifecycleStage') {
      if (LIFECYCLE_STAGES.includes(body.lifecycleStage)) client.lifecycleStage = body.lifecycleStage;
    } else if (field === 'tags') {
      client.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
    } else if (field === 'ownerUserId') {
      client.ownerUserId = body.ownerUserId || null;
    } else if (typeof body[field] === 'string') {
      client[field] = body[field].trim();
    } else {
      client[field] = body[field];
    }
  }
}

export const getCrmSummary = async (req, res) => {
  try {
    assertCrm(req);
    const scope = buildListQuery(req);

    const [contacts, deals, quotes, contracts, activities] = await Promise.all([
      Client.find(scope).select('lifecycleStage').lean(),
      Deal.find(scope).select('stage value').lean(),
      Quote.find(scope).select('status amount').lean(),
      Contract.find({ ...scope, status: 'active' }).countDocuments(),
      CrmActivity.find(scope).sort({ occurredAt: -1 }).limit(8).populate('clientId', 'name').lean(),
    ]);

    const funnel = { lead: 0, prospect: 0, customer: 0, inactive: 0 };
    for (const row of contacts) {
      const key = row.lifecycleStage || 'lead';
      if (key in funnel) funnel[key] += 1;
    }

    const pipeline = {};
    let openPipelineValue = 0;
    for (const stage of DEAL_STAGES) {
      pipeline[stage] = { count: 0, value: 0 };
    }
    for (const deal of deals) {
      const stage = deal.stage || 'lead';
      if (!pipeline[stage]) pipeline[stage] = { count: 0, value: 0 };
      pipeline[stage].count += 1;
      pipeline[stage].value += Number(deal.value) || 0;
      if (stage !== 'won' && stage !== 'lost') {
        openPipelineValue += Number(deal.value) || 0;
      }
    }

    const quotesByStatus = { draft: 0, sent: 0, accepted: 0, rejected: 0, expired: 0 };
    let quoteValue = 0;
    for (const quote of quotes) {
      const status = quote.status || 'draft';
      if (status in quotesByStatus) quotesByStatus[status] += 1;
      if (status === 'sent' || status === 'draft') quoteValue += Number(quote.amount) || 0;
    }

    res.json({
      data: {
        totalContacts: contacts.length,
        funnel,
        pipeline,
        openPipelineValue,
        activeContracts: contracts,
        quotesByStatus,
        pendingQuoteValue: quoteValue,
        recentActivities: activities,
      },
    });
  } catch (error) {
    console.error('Error fetching CRM summary:', error);
    handleScopeError(res, error);
  }
};

export const getCrmContacts = async (req, res) => {
  try {
    assertCrm(req);
    const { lifecycleStage } = req.query;
    const query = buildListQuery(req);
    if (LIFECYCLE_STAGES.includes(lifecycleStage)) query.lifecycleStage = lifecycleStage;

    const contacts = await Client.find(query).sort({ updatedAt: -1 });
    res.json({ data: contacts });
  } catch (error) {
    console.error('Error fetching CRM contacts:', error);
    handleScopeError(res, error);
  }
};

export const createCrmContact = async (req, res) => {
  try {
    assertCrm(req);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const client = new Client({
      name: name.trim(),
      lifecycleStage: LIFECYCLE_STAGES.includes(req.body.lifecycleStage) ? req.body.lifecycleStage : 'lead',
      ...buildCreateScope(req),
    });
    applyClientCrmFields(client, req.body);
    await client.save();
    res.status(201).json({ data: client });
  } catch (error) {
    console.error('Error creating CRM contact:', error);
    handleScopeError(res, error);
  }
};

export const updateCrmContact = async (req, res) => {
  try {
    assertCrm(req);
    const client = await Client.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!client) return res.status(404).json({ error: 'Contact not found' });
    applyClientCrmFields(client, req.body);
    await client.save();
    res.json({ data: client });
  } catch (error) {
    console.error('Error updating CRM contact:', error);
    handleScopeError(res, error);
  }
};

export const getCrmContactProfile = async (req, res) => {
  try {
    assertCrm(req);
    const client = await Client.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!client) return res.status(404).json({ error: 'Contact not found' });

    const scope = buildListQuery(req);
    const [deals, quotes, contracts, activities, invoices] = await Promise.all([
      Deal.find({ ...scope, clientId: client._id }).sort({ updatedAt: -1 }),
      Quote.find({ ...scope, clientId: client._id }).sort({ issueDate: -1 }),
      Contract.find({ ...scope, clientId: client._id }).sort({ startDate: -1 }),
      CrmActivity.find({ ...scope, clientId: client._id }).sort({ occurredAt: -1 }).limit(50),
      Invoice.find({ ...scope, clientId: client._id }).sort({ issueDate: -1 }).limit(10).lean(),
    ]);

    res.json({
      data: {
        client,
        deals,
        quotes,
        contracts,
        activities,
        invoices,
      },
    });
  } catch (error) {
    console.error('Error fetching CRM contact profile:', error);
    handleScopeError(res, error);
  }
};

export const getDeals = async (req, res) => {
  try {
    assertCrm(req);
    const { stage, clientId } = req.query;
    const query = buildListQuery(req);
    if (DEAL_STAGES.includes(stage)) query.stage = stage;
    if (clientId) query.clientId = clientId;

    const deals = await Deal.find(query)
      .populate('clientId', 'name email phone companyName lifecycleStage')
      .sort({ updatedAt: -1 });
    res.json({ data: deals });
  } catch (error) {
    console.error('Error fetching deals:', error);
    handleScopeError(res, error);
  }
};

export const createDeal = async (req, res) => {
  try {
    assertCrm(req);
    const { clientId, title, stage, value, probability, expectedCloseDate, ownerUserId, notes } = req.body;
    if (!clientId) return res.status(400).json({ error: 'Client is required' });
    if (!title?.trim()) return res.status(400).json({ error: 'Deal title is required' });

    const client = await Client.findOne(buildListQuery(req, { _id: clientId }));
    if (!client) return res.status(400).json({ error: 'Invalid client' });

    const scope = buildCreateScope(req);
    const deal = await Deal.create({
      ...scope,
      clientId,
      title: title.trim(),
      stage: DEAL_STAGES.includes(stage) ? stage : 'lead',
      value: Number(value) || 0,
      probability: probability != null ? Math.min(100, Math.max(0, Number(probability))) : 10,
      expectedCloseDate: normalizeDate(expectedCloseDate),
      ownerUserId: ownerUserId || scope.userId,
      notes: notes?.trim() || '',
      wonAt: stage === 'won' ? new Date() : undefined,
      lostAt: stage === 'lost' ? new Date() : undefined,
    });

    const populated = await Deal.findById(deal._id).populate(
      'clientId',
      'name email phone companyName lifecycleStage',
    );
    res.status(201).json({ data: populated });
  } catch (error) {
    console.error('Error creating deal:', error);
    handleScopeError(res, error);
  }
};

export const updateDeal = async (req, res) => {
  try {
    assertCrm(req);
    const deal = await Deal.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const fields = [
      'title',
      'stage',
      'value',
      'probability',
      'expectedCloseDate',
      'ownerUserId',
      'notes',
      'lostReason',
      'clientId',
    ];
    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'stage') {
        if (!DEAL_STAGES.includes(req.body.stage)) continue;
        deal.stage = req.body.stage;
        deal.wonAt = req.body.stage === 'won' ? new Date() : null;
        deal.lostAt = req.body.stage === 'lost' ? new Date() : null;
      } else if (field === 'expectedCloseDate') {
        deal.expectedCloseDate = normalizeDate(req.body.expectedCloseDate) || null;
      } else if (field === 'clientId') {
        const client = await Client.findOne(buildListQuery(req, { _id: req.body.clientId }));
        if (!client) return res.status(400).json({ error: 'Invalid client' });
        deal.clientId = req.body.clientId;
      } else if (typeof req.body[field] === 'string') {
        deal[field] = req.body[field].trim();
      } else {
        deal[field] = req.body[field];
      }
    }

    await deal.save();
    const populated = await Deal.findById(deal._id).populate(
      'clientId',
      'name email phone companyName lifecycleStage',
    );
    res.json({ data: populated });
  } catch (error) {
    console.error('Error updating deal:', error);
    handleScopeError(res, error);
  }
};

export const deleteDeal = async (req, res) => {
  try {
    assertCrm(req);
    const deal = await Deal.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    res.json({ message: 'Deal deleted', data: deal });
  } catch (error) {
    console.error('Error deleting deal:', error);
    handleScopeError(res, error);
  }
};

export const getQuotes = async (req, res) => {
  try {
    assertCrm(req);
    const { status, clientId } = req.query;
    const query = buildListQuery(req);
    if (QUOTE_STATUSES.includes(status)) query.status = status;
    if (clientId) query.clientId = clientId;

    const quotes = await Quote.find(query)
      .populate('clientId', 'name email phone')
      .sort({ issueDate: -1 });
    res.json({ data: quotes });
  } catch (error) {
    console.error('Error fetching quotes:', error);
    handleScopeError(res, error);
  }
};

export const createQuote = async (req, res) => {
  try {
    assertCrm(req);
    const { clientId, dealId, title, lineItems, issueDate, validUntil, status, notes, terms } = req.body;
    if (!clientId) return res.status(400).json({ error: 'Client is required' });
    if (!title?.trim()) return res.status(400).json({ error: 'Quote title is required' });

    const snapshot = await syncClientSnapshot(req, clientId);
    if (!snapshot) return res.status(400).json({ error: 'Invalid client' });

    const items = computeLineItems(lineItems);
    const scope = buildCreateScope(req);
    const quote = await Quote.create({
      ...scope,
      ...snapshot,
      quoteNumber: await generateQuoteNumber(req),
      title: title.trim(),
      dealId: dealId || null,
      lineItems: items,
      amount: sumLineItems(items),
      issueDate: normalizeDate(issueDate) || new Date(),
      validUntil: normalizeDate(validUntil),
      status: QUOTE_STATUSES.includes(status) ? status : 'draft',
      notes: notes?.trim() || '',
      terms: terms?.trim() || '',
    });

    res.status(201).json({ data: quote });
  } catch (error) {
    console.error('Error creating quote:', error);
    handleScopeError(res, error);
  }
};

export const updateQuote = async (req, res) => {
  try {
    assertCrm(req);
    const quote = await Quote.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    if (req.body.title !== undefined) quote.title = String(req.body.title).trim();
    if (req.body.status !== undefined && QUOTE_STATUSES.includes(req.body.status)) {
      quote.status = req.body.status;
    }
    if (req.body.validUntil !== undefined) quote.validUntil = normalizeDate(req.body.validUntil) || null;
    if (req.body.notes !== undefined) quote.notes = String(req.body.notes).trim();
    if (req.body.terms !== undefined) quote.terms = String(req.body.terms).trim();
    if (req.body.lineItems !== undefined) {
      quote.lineItems = computeLineItems(req.body.lineItems);
      quote.amount = sumLineItems(quote.lineItems);
    }

    await quote.save();
    res.json({ data: quote });
  } catch (error) {
    console.error('Error updating quote:', error);
    handleScopeError(res, error);
  }
};

export const deleteQuote = async (req, res) => {
  try {
    assertCrm(req);
    const quote = await Quote.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ message: 'Quote deleted', data: quote });
  } catch (error) {
    console.error('Error deleting quote:', error);
    handleScopeError(res, error);
  }
};

export const convertQuoteToInvoice = async (req, res) => {
  try {
    assertCrm(req);
    const quote = await Quote.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.convertedInvoiceId) {
      return res.status(400).json({ error: 'Quote already converted to invoice' });
    }

    const scope = buildCreateScope(req);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await Invoice.create({
      ...scope,
      invoiceNumber: await generateInvoiceNumber(scope.userId),
      title: quote.title,
      clientId: quote.clientId,
      clientName: quote.clientName,
      clientEmail: quote.clientEmail,
      clientPhone: quote.clientPhone,
      lineItems: quote.lineItems,
      amount: quote.amount,
      issueDate: new Date(),
      dueDate,
      status: 'draft',
      note: quote.notes,
      terms: quote.terms,
    });

    quote.status = 'accepted';
    quote.convertedInvoiceId = invoice._id;
    await quote.save();

    res.status(201).json({ data: { quote, invoice } });
  } catch (error) {
    console.error('Error converting quote:', error);
    handleScopeError(res, error);
  }
};

export const getContracts = async (req, res) => {
  try {
    assertCrm(req);
    const { status, clientId } = req.query;
    const query = buildListQuery(req);
    if (CONTRACT_STATUSES.includes(status)) query.status = status;
    if (clientId) query.clientId = clientId;

    const contracts = await Contract.find(query)
      .populate('clientId', 'name email phone companyName')
      .sort({ startDate: -1 });
    res.json({ data: contracts });
  } catch (error) {
    console.error('Error fetching contracts:', error);
    handleScopeError(res, error);
  }
};

export const createContract = async (req, res) => {
  try {
    assertCrm(req);
    const { clientId, dealId, title, status, startDate, endDate, renewalDate, value, notes } = req.body;
    if (!clientId) return res.status(400).json({ error: 'Client is required' });
    if (!title?.trim()) return res.status(400).json({ error: 'Contract title is required' });

    const client = await Client.findOne(buildListQuery(req, { _id: clientId }));
    if (!client) return res.status(400).json({ error: 'Invalid client' });

    const scope = buildCreateScope(req);
    const contract = await Contract.create({
      ...scope,
      clientId,
      dealId: dealId || null,
      title: title.trim(),
      status: CONTRACT_STATUSES.includes(status) ? status : 'draft',
      startDate: normalizeDate(startDate),
      endDate: normalizeDate(endDate),
      renewalDate: normalizeDate(renewalDate),
      value: Number(value) || 0,
      notes: notes?.trim() || '',
    });

    const populated = await Contract.findById(contract._id).populate('clientId', 'name email phone companyName');
    res.status(201).json({ data: populated });
  } catch (error) {
    console.error('Error creating contract:', error);
    handleScopeError(res, error);
  }
};

export const updateContract = async (req, res) => {
  try {
    assertCrm(req);
    const contract = await Contract.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const fields = ['title', 'status', 'startDate', 'endDate', 'renewalDate', 'value', 'notes', 'dealId'];
    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (['startDate', 'endDate', 'renewalDate'].includes(field)) {
        contract[field] = normalizeDate(req.body[field]) || null;
      } else if (field === 'status') {
        if (CONTRACT_STATUSES.includes(req.body.status)) contract.status = req.body.status;
      } else if (typeof req.body[field] === 'string') {
        contract[field] = req.body[field].trim();
      } else {
        contract[field] = req.body[field];
      }
    }

    await contract.save();
    const populated = await Contract.findById(contract._id).populate('clientId', 'name email phone companyName');
    res.json({ data: populated });
  } catch (error) {
    console.error('Error updating contract:', error);
    handleScopeError(res, error);
  }
};

export const deleteContract = async (req, res) => {
  try {
    assertCrm(req);
    const contract = await Contract.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    res.json({ message: 'Contract deleted', data: contract });
  } catch (error) {
    console.error('Error deleting contract:', error);
    handleScopeError(res, error);
  }
};

export const createCrmActivity = async (req, res) => {
  try {
    assertCrm(req);
    const { clientId, dealId, activityType, channel, subject, body, occurredAt } = req.body;
    if (!clientId) return res.status(400).json({ error: 'Client is required' });

    const client = await Client.findOne(buildListQuery(req, { _id: clientId }));
    if (!client) return res.status(400).json({ error: 'Invalid client' });

    const scope = buildCreateScope(req);
    const activity = await CrmActivity.create({
      ...scope,
      clientId,
      dealId: dealId || null,
      activityType: ['note', 'call', 'email', 'meeting', 'message'].includes(activityType)
        ? activityType
        : 'note',
      channel: channel || 'internal',
      subject: subject?.trim() || '',
      body: body?.trim() || '',
      occurredAt: normalizeDate(occurredAt) || new Date(),
      ...actorFromRequest(req),
    });

    res.status(201).json({ data: activity });
  } catch (error) {
    console.error('Error creating CRM activity:', error);
    handleScopeError(res, error);
  }
};

export const deleteCrmActivity = async (req, res) => {
  try {
    assertCrm(req);
    const activity = await CrmActivity.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    res.json({ message: 'Activity deleted', data: activity });
  } catch (error) {
    console.error('Error deleting CRM activity:', error);
    handleScopeError(res, error);
  }
};
