// Barber Report Controller
import Sale from '../models/Sale.js';
import Barber from '../models/Barber.js';
import Service from '../models/Service.js';
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

export const getDailyBarberReport = async (req, res) => {
  try {
    const { userId, ownerId, user } = await getUserInfo(req);
    if (!userId || !ownerId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { date } = req.query;
    
    // Parse date or use today
    let targetDate;
    if (date) {
      targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
    } else {
      targetDate = new Date();
      targetDate.setHours(0, 0, 0, 0);
    }

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Get all service sales for the date (use ownerId so barbers see their salon's data)
    const sales = await Sale.find({
      userId: ownerId,
      isService: true,
      date: {
        $gte: targetDate,
        $lt: nextDay,
      },
    })
      .populate('serviceId', 'name category')
      .populate('barberId', 'name')
      .sort({ date: 1 });

    // Group by barber
    const barberMap = new Map();

    sales.forEach((sale) => {
      const barberId = sale.barberId?._id?.toString() || sale.barberId?.toString();
      const barberName = sale.barberId?.name || 'Unknown';

      if (!barberMap.has(barberId)) {
        barberMap.set(barberId, {
          barberId: barberId,
          barberName: barberName,
          totalRevenue: 0,
          serviceCount: 0,
          services: [],
          serviceBreakdown: new Map(),
        });
      }

      const barberData = barberMap.get(barberId);
      barberData.totalRevenue += sale.revenue || 0;
      barberData.serviceCount += sale.quantity || 1;

      const serviceName = sale.serviceId?.name || sale.product || 'Unknown Service';
      const currentCount = barberData.serviceBreakdown.get(serviceName) || 0;
      barberData.serviceBreakdown.set(serviceName, currentCount + (sale.quantity || 1));

      barberData.services.push({
        serviceName: serviceName,
        serviceCategory: sale.serviceId?.category,
        revenue: sale.revenue,
        quantity: sale.quantity,
        date: sale.date,
        paymentMethod: sale.paymentMethod,
      });
    });

    // Convert to array and format breakdown
    const report = Array.from(barberMap.values()).map((barber) => ({
      barberId: barber.barberId,
      barberName: barber.barberName,
      totalRevenue: barber.totalRevenue,
      serviceCount: barber.serviceCount,
      serviceBreakdown: Array.from(barber.serviceBreakdown.entries()).map(([service, count]) => ({
        serviceName: service,
        count: count,
      })),
      services: barber.services,
    }));

    res.json({
      data: {
        date: targetDate.toISOString().split('T')[0],
        barbers: report,
        totalRevenue: report.reduce((sum, b) => sum + b.totalRevenue, 0),
        totalServices: report.reduce((sum, b) => sum + b.serviceCount, 0),
      },
    });
  } catch (error) {
    console.error('Get daily barber report error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch daily barber report' });
  }
};

export const getBarberSales = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { barberId } = req.params;
    const { startDate, endDate } = req.query;

    // Validate barber belongs to user
    const barber = await Barber.findOne({ _id: barberId, userId });
    if (!barber) {
      return res.status(404).json({ error: 'Barber not found' });
    }

    const query = {
      userId,
      isService: true,
      barberId,
    };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const sales = await Sale.find(query)
      .populate('serviceId', 'name category defaultPrice')
      .sort({ date: -1 });

    res.json({ data: sales });
  } catch (error) {
    console.error('Get barber sales error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch barber sales' });
  }
};

export const getBarberStats = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { barberId } = req.params;
    const { startDate, endDate } = req.query;

    // Validate barber belongs to user
    const barber = await Barber.findOne({ _id: barberId, userId });
    if (!barber) {
      return res.status(404).json({ error: 'Barber not found' });
    }

    const query = {
      userId,
      isService: true,
      barberId,
    };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const sales = await Sale.find(query);

    const stats = {
      totalRevenue: sales.reduce((sum, sale) => sum + (sale.revenue || 0), 0),
      totalServices: sales.reduce((sum, sale) => sum + (sale.quantity || 1), 0),
      saleCount: sales.length,
      averageRevenue: 0,
      serviceBreakdown: {},
    };

    if (stats.saleCount > 0) {
      stats.averageRevenue = stats.totalRevenue / stats.saleCount;
    }

    // Group by service
    sales.forEach((sale) => {
      const serviceId = sale.serviceId?.toString() || 'unknown';
      if (!stats.serviceBreakdown[serviceId]) {
        stats.serviceBreakdown[serviceId] = {
          serviceId: serviceId,
          count: 0,
          revenue: 0,
        };
      }
      stats.serviceBreakdown[serviceId].count += sale.quantity || 1;
      stats.serviceBreakdown[serviceId].revenue += sale.revenue || 0;
    });

    // Populate service names
    const serviceIds = Object.keys(stats.serviceBreakdown).filter(id => id !== 'unknown');
    if (serviceIds.length > 0) {
      const services = await Service.find({ _id: { $in: serviceIds }, userId });
      services.forEach((service) => {
        const serviceId = service._id.toString();
        if (stats.serviceBreakdown[serviceId]) {
          stats.serviceBreakdown[serviceId].serviceName = service.name;
        }
      });
    }

    res.json({ data: stats });
  } catch (error) {
    console.error('Get barber stats error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch barber stats' });
  }
};
