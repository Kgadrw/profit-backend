// Admin Controller
import User from '../models/User.js';
import Product from '../models/Product.js';
import Sale from '../models/Sale.js';

// Get system statistics
export const getSystemStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalProducts = await Product.countDocuments();
    const totalSales = await Sale.countDocuments();
    
    // Calculate total revenue and profit
    const salesData = await Sale.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$revenue' },
          totalCost: { $sum: '$cost' },
          totalProfit: { $sum: '$profit' },
        },
      },
    ]);

    const stats = salesData[0] || { totalRevenue: 0, totalCost: 0, totalProfit: 0 };

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentUsers = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    const recentProducts = await Product.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    const recentSales = await Sale.countDocuments({
      date: { $gte: sevenDaysAgo },
    });

    res.json({
      data: {
        totalUsers,
        totalProducts,
        totalSales,
        totalRevenue: stats.totalRevenue || 0,
        totalCost: stats.totalCost || 0,
        totalProfit: stats.totalProfit || 0,
        recentUsers,
        recentProducts,
        recentSales,
      },
    });
  } catch (error) {
    console.error('Get system stats error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch system stats' });
  }
};

// Get all users
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-pin')
      .sort({ createdAt: -1 })
      .lean();

    // Get activity stats for each user
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const productCount = await Product.countDocuments({ userId: user._id });
        const saleCount = await Sale.countDocuments({ userId: user._id });
        
        const salesData = await Sale.aggregate([
          { $match: { userId: user._id } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$revenue' },
              totalProfit: { $sum: '$profit' },
            },
          },
        ]);

        const salesStats = salesData[0] || { totalRevenue: 0, totalProfit: 0 };

        return {
          ...user,
          productCount,
          saleCount,
          totalRevenue: salesStats.totalRevenue || 0,
          totalProfit: salesStats.totalProfit || 0,
        };
      })
    );

    res.json({ data: usersWithStats });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch users' });
  }
};

// Get user activity
export const getUserActivity = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get product creation activity
    const productActivity = await Product.find({
      createdAt: { $gte: startDate },
    })
      .select('name createdAt userId')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    // Get sales activity
    const salesActivity = await Sale.find({
      date: { $gte: startDate },
    })
      .select('product quantity revenue profit date userId')
      .populate('userId', 'name email')
      .sort({ date: -1 })
      .lean();

    // Get user registration activity
    const userActivity = await User.find({
      createdAt: { $gte: startDate },
    })
      .select('name email createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      data: {
        products: productActivity,
        sales: salesActivity,
        users: userActivity,
      },
    });
  } catch (error) {
    console.error('Get user activity error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch user activity' });
  }
};

// Get API call statistics
export const getApiStats = async (req, res) => {
  try {
    const { getApiRequestStats, getLiveApiRequests } = await import('../middleware/apiTracker.js');
    const apiStats = getApiRequestStats();
    const liveRequests = getLiveApiRequests(100);

    res.json({ 
      data: {
        ...apiStats,
        liveRequests,
      }
    });
  } catch (error) {
    console.error('Get API stats error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch API stats' });
  }
};

// Get system health
export const getSystemHealth = async (req, res) => {
  try {
    // Check database connection
    let databaseStatus = 'connected';
    try {
      await Product.findOne().limit(1);
    } catch (error) {
      databaseStatus = 'disconnected';
    }

    const health = {
      database: databaseStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      serverStartTime: new Date(Date.now() - (process.uptime() * 1000)).toISOString(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    };

    res.json({ data: health });
  } catch (error) {
    console.error('Get system health error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch system health' });
  }
};

// Get user usage statistics
export const getUserUsage = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get all users
    const allUsers = await User.find().select('-pin').lean();

    // Get usage statistics for each user
    const userUsageStats = await Promise.all(
      allUsers.map(async (user) => {
        // Count products created by user
        const totalProducts = await Product.countDocuments({ userId: user._id });
        const recentProducts = await Product.countDocuments({
          userId: user._id,
          createdAt: { $gte: startDate },
        });

        // Count sales made by user
        const totalSales = await Sale.countDocuments({ userId: user._id });
        const recentSales = await Sale.countDocuments({
          userId: user._id,
          date: { $gte: startDate },
        });

        // Get last product creation date
        const lastProduct = await Product.findOne({ userId: user._id })
          .sort({ createdAt: -1 })
          .select('createdAt')
          .lean();

        // Get last sale date
        const lastSale = await Sale.findOne({ userId: user._id })
          .sort({ date: -1 })
          .select('date')
          .lean();

        // Calculate activity score (products + sales in last period)
        const activityScore = recentProducts + recentSales;

        // Get sales revenue and profit
        const salesData = await Sale.aggregate([
          { $match: { userId: user._id } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$revenue' },
              totalProfit: { $sum: '$profit' },
            },
          },
        ]);

        const salesStats = salesData[0] || { totalRevenue: 0, totalProfit: 0 };

        // Calculate average sales per day (if user has sales)
        const daysSinceFirstSale = lastSale
          ? Math.max(1, Math.floor((new Date() - new Date(lastSale.date)) / (1000 * 60 * 60 * 24)))
          : 0;
        const avgSalesPerDay = daysSinceFirstSale > 0 ? (totalSales / daysSinceFirstSale).toFixed(2) : 0;

        return {
          userId: user._id,
          name: user.name,
          email: user.email || null,
          businessName: user.businessName || null,
          joinedDate: user.createdAt,
          totalProducts,
          recentProducts,
          totalSales,
          recentSales,
          totalRevenue: salesStats.totalRevenue || 0,
          totalProfit: salesStats.totalProfit || 0,
          lastProductDate: lastProduct?.createdAt || null,
          lastSaleDate: lastSale?.date || null,
          activityScore,
          avgSalesPerDay: parseFloat(avgSalesPerDay),
          isActive: activityScore > 0,
        };
      })
    );

    // Sort by activity score (most active first)
    userUsageStats.sort((a, b) => b.activityScore - a.activityScore);

    // Calculate summary statistics
    const summary = {
      totalUsers: userUsageStats.length,
      activeUsers: userUsageStats.filter((u) => u.isActive).length,
      inactiveUsers: userUsageStats.filter((u) => !u.isActive).length,
      totalProductsCreated: userUsageStats.reduce((sum, u) => sum + u.totalProducts, 0),
      totalSalesMade: userUsageStats.reduce((sum, u) => sum + u.totalSales, 0),
      avgProductsPerUser: userUsageStats.length > 0
        ? (userUsageStats.reduce((sum, u) => sum + u.totalProducts, 0) / userUsageStats.length).toFixed(2)
        : 0,
      avgSalesPerUser: userUsageStats.length > 0
        ? (userUsageStats.reduce((sum, u) => sum + u.totalSales, 0) / userUsageStats.length).toFixed(2)
        : 0,
    };

    res.json({
      data: {
        users: userUsageStats,
        summary,
      },
    });
  } catch (error) {
    console.error('Get user usage error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch user usage statistics' });
  }
};
