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
    const { name, email, phone, businessType, clientType, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Client email is required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    if (!businessType) {
      return res.status(400).json({ error: 'Business type is required' });
    }

    const client = new Client({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : undefined,
      businessType: businessType.trim(),
      clientType: clientType || 'other',
      notes: notes ? notes.trim() : undefined,
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
    const { name, email, phone, businessType, clientType, notes } = req.body;

    const client = await Client.findOne({ _id: req.params.id, userId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (name !== undefined) client.name = name.trim();
    if (email !== undefined) {
      if (!email || !email.trim()) {
        return res.status(400).json({ error: 'Client email is required' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }
      client.email = email.trim().toLowerCase();
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
