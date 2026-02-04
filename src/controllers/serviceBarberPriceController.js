// Service-Barber Price Controller
import ServiceBarberPrice from '../models/ServiceBarberPrice.js';
import Service from '../models/Service.js';
import Barber from '../models/Barber.js';
import User from '../models/User.js';

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

export const getPrices = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { serviceId, barberId } = req.query;
    const query = { userId: ownerId };
    
    if (serviceId) query.serviceId = serviceId;
    if (barberId) query.barberId = barberId;

    const prices = await ServiceBarberPrice.find(query)
      .populate('serviceId', 'name defaultPrice')
      .populate('barberId', 'name')
      .sort({ serviceId: 1, barberId: 1 });
    
    res.json({ data: prices });
  } catch (error) {
    console.error('Get prices error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch prices' });
  }
};

export const getPrice = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { serviceId, barberId } = req.params;

    const price = await ServiceBarberPrice.findOne({
      userId: ownerId,
      serviceId,
      barberId,
    })
      .populate('serviceId', 'name defaultPrice')
      .populate('barberId', 'name');

    if (!price) {
      return res.status(404).json({ error: 'Price not found' });
    }

    res.json({ data: price });
  } catch (error) {
    console.error('Get price error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch price' });
  }
};

export const setPrice = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Only salon owners can set prices
    if (user.role !== 'salon_owner') {
      return res.status(403).json({ error: 'Only salon owners can set service prices' });
    }

    const { serviceId, barberId, fixedAmount } = req.body;

    // Validate service and barber belong to owner
    const service = await Service.findOne({ _id: serviceId, userId: ownerId });
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const barber = await Barber.findOne({ _id: barberId, userId: ownerId });
    if (!barber) {
      return res.status(404).json({ error: 'Barber not found' });
    }

    const priceData = {
      serviceId,
      barberId,
      fixedAmount: parseFloat(fixedAmount),
      userId: ownerId,
    };

    // Use upsert to create or update
    const price = await ServiceBarberPrice.findOneAndUpdate(
      { userId: ownerId, serviceId, barberId },
      priceData,
      { new: true, upsert: true, runValidators: true }
    )
      .populate('serviceId', 'name defaultPrice')
      .populate('barberId', 'name');

    res.json({ 
      message: 'Price set successfully',
      data: price 
    });
  } catch (error) {
    console.error('Set price error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to set price' });
  }
};

export const bulkSetPrices = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Only salon owners can set prices
    if (user.role !== 'salon_owner') {
      return res.status(403).json({ error: 'Only salon owners can set service prices' });
    }

    const { prices } = req.body; // Array of { serviceId, barberId, fixedAmount }

    if (!Array.isArray(prices)) {
      return res.status(400).json({ error: 'Prices must be an array' });
    }

    const results = [];
    for (const priceData of prices) {
      const { serviceId, barberId, fixedAmount } = priceData;

      // Validate service and barber belong to owner
      const service = await Service.findOne({ _id: serviceId, userId: ownerId });
      const barber = await Barber.findOne({ _id: barberId, userId: ownerId });

      if (!service || !barber) {
        results.push({ serviceId, barberId, error: 'Service or barber not found' });
        continue;
      }

      try {
        const price = await ServiceBarberPrice.findOneAndUpdate(
          { userId: ownerId, serviceId, barberId },
          { serviceId, barberId, fixedAmount: parseFloat(fixedAmount), userId: ownerId },
          { new: true, upsert: true, runValidators: true }
        );
        results.push({ serviceId, barberId, success: true, data: price });
      } catch (error) {
        results.push({ serviceId, barberId, error: error.message });
      }
    }

    res.json({ 
      message: 'Bulk price update completed',
      data: results 
    });
  } catch (error) {
    console.error('Bulk set prices error:', error);
    res.status(500).json({ error: error.message || 'Failed to set prices' });
  }
};

export const deletePrice = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Only salon owners can delete prices
    if (user.role !== 'salon_owner') {
      return res.status(403).json({ error: 'Only salon owners can delete service prices' });
    }

    const { serviceId, barberId } = req.params;

    const price = await ServiceBarberPrice.findOneAndDelete({
      userId: ownerId,
      serviceId,
      barberId,
    });

    if (!price) {
      return res.status(404).json({ error: 'Price not found' });
    }

    res.json({ 
      message: 'Price deleted successfully',
      data: price 
    });
  } catch (error) {
    console.error('Delete price error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete price' });
  }
};
