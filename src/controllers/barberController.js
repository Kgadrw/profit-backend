// Barber Controller
import Barber from '../models/Barber.js';
import User from '../models/User.js';
import { emitToUser } from '../utils/websocket.js';

// Helper to get userId and ownerId from request (supports both salon owners and barbers)
const getUserInfo = async (req) => {
  // First try to get userId from header
  const userIdFromHeader = req.headers['x-user-id'];
  if (!userIdFromHeader) {
    return { userId: null, ownerId: null, user: null };
  }
  
  // Validate it's a valid MongoDB ObjectId
  const mongoose = (await import('mongoose')).default;
  if (!mongoose.Types.ObjectId.isValid(userIdFromHeader)) {
    return { userId: null, ownerId: null, user: null };
  }
  
  // Get user to check role
  const user = await User.findById(userIdFromHeader);
  if (!user) {
    return { userId: null, ownerId: null, user: null };
  }
  
  // If barber, use salonOwnerId; if salon owner, use userId
  const ownerId = user.role === 'barber' ? user.salonOwnerId : user._id;
  
  return { userId: user._id, ownerId, user };
};

export const getBarbers = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { includeInactive } = req.query;
    const query = { userId: ownerId }; // Use ownerId (salonOwnerId for barbers, userId for salon owners)
    if (includeInactive !== 'true') {
      query.isActive = true;
    }

    const barbers = await Barber.find(query).sort({ name: 1 });
    res.json({ data: barbers });
  } catch (error) {
    console.error('Get barbers error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch barbers' });
  }
};

export const getBarber = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const barber = await Barber.findOne({ _id: req.params.id, userId: ownerId });
    if (!barber) {
      return res.status(404).json({ error: 'Barber not found' });
    }
    res.json({ data: barber });
  } catch (error) {
    console.error('Get barber error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch barber' });
  }
};

export const createBarber = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Both salon owners and barbers can create barbers
    // Barbers create barbers under their salon owner's account

    const barberData = {
      ...req.body,
      userId: ownerId, // Use ownerId (salonOwnerId for barbers, userId for salon owners)
    };

    // Check for duplicate barber name
    const existingBarber = await Barber.findOne({ 
      userId: ownerId, 
      name: { $regex: new RegExp(`^${barberData.name.trim()}$`, 'i') }
    });
    
    if (existingBarber) {
      return res.status(409).json({ 
        error: 'A barber with this name already exists.',
        duplicate: true
      });
    }

    const barber = new Barber(barberData);
    await barber.save();

    // Emit WebSocket event for real-time update (to ownerId, so both salon owner and barbers see it)
    emitToUser(ownerId.toString(), 'barber:created', barber.toObject());

    res.status(201).json({ 
      message: 'Barber created successfully',
      data: barber 
    });
  } catch (error) {
    console.error('Create barber error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to create barber' });
  }
};

export const updateBarber = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Only salon owners can update barbers
    if (user.role !== 'salon_owner') {
      return res.status(403).json({ error: 'Only salon owners can update barbers' });
    }

    const updateData = { ...req.body };

    // Check for duplicate name if name is being updated
    if (updateData.name) {
      const existingBarber = await Barber.findOne({ 
        userId: ownerId, 
        name: { $regex: new RegExp(`^${updateData.name.trim()}$`, 'i') },
        _id: { $ne: req.params.id }
      });
      
      if (existingBarber) {
        return res.status(409).json({ 
          error: 'A barber with this name already exists.',
          duplicate: true
        });
      }
    }

    const barber = await Barber.findOneAndUpdate(
      { _id: req.params.id, userId: ownerId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!barber) {
      return res.status(404).json({ error: 'Barber not found' });
    }

    // Emit WebSocket event for real-time update
    emitToUser(ownerId.toString(), 'barber:updated', barber.toObject());

    res.json({ 
      message: 'Barber updated successfully',
      data: barber 
    });
  } catch (error) {
    console.error('Update barber error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to update barber' });
  }
};

export const deleteBarber = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Only salon owners can delete barbers
    if (user.role !== 'salon_owner') {
      return res.status(403).json({ error: 'Only salon owners can delete barbers' });
    }

    // Soft delete - set isActive to false instead of actually deleting
    const barber = await Barber.findOneAndUpdate(
      { _id: req.params.id, userId: ownerId },
      { isActive: false },
      { new: true }
    );

    if (!barber) {
      return res.status(404).json({ error: 'Barber not found' });
    }

    // Emit WebSocket event for real-time update
    emitToUser(ownerId.toString(), 'barber:deleted', { _id: barber._id });

    res.json({ 
      message: 'Barber deleted successfully',
      data: barber 
    });
  } catch (error) {
    console.error('Delete barber error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete barber' });
  }
};
