// Client Controller
import Client from '../models/Client.js';

// Get all clients for a user
export const getClients = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access client data' });
    }
    const clients = await Client.find({ userId }).sort({ createdAt: -1 });
    res.json({ data: clients });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
};

// Get a single client
export const getClient = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access client data' });
    }
    const client = await Client.findOne({ _id: req.params.id, userId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({ data: client });
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
};

// Create a new client
export const createClient = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create clients' });
    }
    const { name, email, phone, businessType, clientType, notes, workerStatus, discipline, lastCheckIn, lastCheckOut } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    if (!businessType) {
      return res.status(400).json({ error: 'Business type is required' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const client = new Client({
      name: name.trim(),
      email: email ? email.trim().toLowerCase() : undefined,
      phone: phone ? phone.trim() : undefined,
      businessType: businessType.trim(),
      clientType: clientType || 'other',
      notes: notes ? notes.trim() : undefined,
      workerStatus: workerStatus || 'active',
      discipline: discipline || 'good',
      lastCheckIn: lastCheckIn ? new Date(lastCheckIn) : undefined,
      lastCheckOut: lastCheckOut ? new Date(lastCheckOut) : undefined,
      userId,
    });

    await client.save();
    res.status(201).json({ data: client });
  } catch (error) {
    console.error('Error creating client:', error);
    if (error.code === 11000) {
      res.status(400).json({ error: 'Client with this email already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create client' });
    }
  }
};

// Update a client
export const updateClient = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update clients' });
    }
    const { name, email, phone, businessType, clientType, notes, workerStatus, discipline, lastCheckIn, lastCheckOut } = req.body;

    const client = await Client.findOne({ _id: req.params.id, userId });
    
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
      if (!businessType || !businessType.trim()) {
        return res.status(400).json({ error: 'Business type is required' });
      }
      client.businessType = businessType.trim();
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
    res.status(500).json({ error: 'Failed to update client' });
  }
};

// Delete a client
export const deleteClient = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete clients' });
    }
    const client = await Client.findOneAndDelete({ _id: req.params.id, userId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
};
