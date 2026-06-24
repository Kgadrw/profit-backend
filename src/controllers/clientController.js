import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
import Income from '../models/Income.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

export const getClients = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
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
