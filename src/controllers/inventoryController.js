// Inventory Controller
import Inventory from '../models/Inventory.js';
import Product from '../models/Product.js';
import { emitToUser } from '../utils/websocket.js';

// Helper to get userId from request (matches existing pattern)
const getUserId = async (req) => {
  const userIdFromHeader = req.headers['x-user-id'];
  if (userIdFromHeader) {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.Types.ObjectId.isValid(userIdFromHeader)) {
      return userIdFromHeader;
    }
  }
  return null;
};

export const getInventories = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const inventories = await Inventory.find({ userId }).sort({ createdAt: -1 });
    res.json({ data: inventories });
  } catch (error) {
    console.error('Get inventories error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch inventories' });
  }
};

export const getInventory = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const inventory = await Inventory.findOne({ _id: req.params.id, userId });
    if (!inventory) {
      return res.status(404).json({ error: 'Inventory not found' });
    }
    res.json({ data: inventory });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch inventory' });
  }
};

export const createInventory = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const inventory = new Inventory({
      name: req.body.name,
      description: req.body.description,
      userId,
    });

    await inventory.save();
    emitToUser(userId, 'inventory:created', inventory.toObject());

    res.status(201).json({
      message: 'Inventory created successfully',
      data: inventory,
    });
  } catch (error) {
    console.error('Create inventory error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'An inventory with this name already exists.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to create inventory' });
  }
};

export const updateInventory = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const updateData = { ...req.body };
    delete updateData.__v;
    delete updateData.userId;

    const inventory = await Inventory.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!inventory) {
      return res.status(404).json({ error: 'Inventory not found' });
    }

    emitToUser(userId, 'inventory:updated', inventory.toObject());

    res.json({
      message: 'Inventory updated successfully',
      data: inventory,
    });
  } catch (error) {
    console.error('Update inventory error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'An inventory with this name already exists.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to update inventory' });
  }
};

export const deleteInventory = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const inventory = await Inventory.findOne({ _id: req.params.id, userId });
    if (!inventory) {
      return res.status(404).json({ error: 'Inventory not found' });
    }

    const productCount = await Product.countDocuments({ userId, inventoryId: inventory._id });
    if (productCount > 0) {
      return res.status(409).json({
        error: 'Inventory has products. Move/delete products first.',
        productCount,
      });
    }

    await Inventory.deleteOne({ _id: inventory._id, userId });
    emitToUser(userId, 'inventory:deleted', { _id: inventory._id });

    res.json({
      message: 'Inventory deleted successfully',
      data: inventory,
    });
  } catch (error) {
    console.error('Delete inventory error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete inventory' });
  }
};

