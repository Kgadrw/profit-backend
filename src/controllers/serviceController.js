// Service Controller
import Service from '../models/Service.js';
import User from '../models/User.js';
import { emitToUser } from '../utils/websocket.js';

// Helper to get userId and ownerId from request (supports both salon owners and barbers)
const getUserInfo = async (req) => {
  const userIdFromHeader = req.headers['x-user-id'];
  if (!userIdFromHeader) {
    return { userId: null, ownerId: null, user: null };
  }
  
  const mongoose = (await import('mongoose')).default;
  if (!mongoose.Types.ObjectId.isValid(userIdFromHeader)) {
    return { userId: null, ownerId: null, user: null };
  }
  
  const user = await User.findById(userIdFromHeader);
  if (!user) {
    return { userId: null, ownerId: null, user: null };
  }
  
  const ownerId = user.role === 'barber' ? user.salonOwnerId : user._id;
  return { userId: user._id, ownerId, user };
};

export const getServices = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { includeInactive } = req.query;
    const query = { userId: ownerId };
    if (includeInactive !== 'true') {
      query.isActive = true;
    }

    const services = await Service.find(query).sort({ name: 1 });
    res.json({ data: services });
  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch services' });
  }
};

export const getService = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const service = await Service.findOne({ _id: req.params.id, userId: ownerId });
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json({ data: service });
  } catch (error) {
    console.error('Get service error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch service' });
  }
};

export const createService = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Only salon owners can create services
    if (user.role !== 'salon_owner') {
      return res.status(403).json({ error: 'Only salon owners can create services' });
    }

    const serviceData = {
      ...req.body,
      userId: ownerId,
    };

    // Convert string numbers to numbers
    if (serviceData.defaultPrice) {
      serviceData.defaultPrice = parseFloat(serviceData.defaultPrice);
    }

    // Check for duplicate service name
    const normalizedName = serviceData.name.trim().toLowerCase();
    const existingService = await Service.findOne({ 
      userId: ownerId, 
      name: { $regex: new RegExp(`^${normalizedName}$`, 'i') }
    });
    
    if (existingService) {
      return res.status(409).json({ 
        error: 'A service with this name already exists.',
        duplicate: true
      });
    }

    const service = new Service(serviceData);
    await service.save();

    // Emit WebSocket event for real-time update
    emitToUser(ownerId.toString(), 'service:created', service.toObject());

    res.status(201).json({ 
      message: 'Service created successfully',
      data: service 
    });
  } catch (error) {
    console.error('Create service error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to create service' });
  }
};

export const updateService = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Only salon owners can update services
    if (user.role !== 'salon_owner') {
      return res.status(403).json({ error: 'Only salon owners can update services' });
    }

    const updateData = { ...req.body };
    
    // Convert string numbers to numbers
    if (updateData.defaultPrice) {
      updateData.defaultPrice = parseFloat(updateData.defaultPrice);
    }

    // Check for duplicate name if name is being updated
    if (updateData.name) {
      const normalizedName = updateData.name.trim().toLowerCase();
      const existingService = await Service.findOne({ 
        userId: ownerId, 
        name: { $regex: new RegExp(`^${normalizedName}$`, 'i') },
        _id: { $ne: req.params.id }
      });
      
      if (existingService) {
        return res.status(409).json({ 
          error: 'A service with this name already exists.',
          duplicate: true
        });
      }
    }

    const service = await Service.findOneAndUpdate(
      { _id: req.params.id, userId: ownerId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Emit WebSocket event for real-time update
    emitToUser(ownerId.toString(), 'service:updated', service.toObject());

    res.json({ 
      message: 'Service updated successfully',
      data: service 
    });
  } catch (error) {
    console.error('Update service error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to update service' });
  }
};

export const deleteService = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Only salon owners can delete services
    if (user.role !== 'salon_owner') {
      return res.status(403).json({ error: 'Only salon owners can delete services' });
    }

    // Soft delete - set isActive to false instead of actually deleting
    const service = await Service.findOneAndUpdate(
      { _id: req.params.id, userId: ownerId },
      { isActive: false },
      { new: true }
    );

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Emit WebSocket event for real-time update
    emitToUser(ownerId.toString(), 'service:deleted', { _id: service._id });

    res.json({ 
      message: 'Service deleted successfully',
      data: service 
    });
  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete service' });
  }
};
