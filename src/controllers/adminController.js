// Admin Controller
import User from '../models/User.js';
import Product from '../models/Product.js';
import Sale from '../models/Sale.js';
import Schedule from '../models/Schedule.js';
import Client from '../models/Client.js';
import ServerStatus from '../models/ServerStatus.js';
import { sendEmail } from '../utils/emailService.js';

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

    // Get server status history (last 3 months)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const statusHistory = await ServerStatus.find({
      timestamp: { $gte: threeMonthsAgo }
    })
      .sort({ timestamp: 1 })
      .select('status timestamp')
      .lean();

    const health = {
      database: databaseStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      serverStartTime: new Date(Date.now() - (process.uptime() * 1000)).toISOString(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
      statusHistory: statusHistory || [],
    };

    res.json({ data: health });
  } catch (error) {
    console.error('Get system health error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch system health' });
  }
};

// Delete user and all their data
export const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate userId
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting admin user (optional safety check)
    if (user.email === 'admin') {
      return res.status(403).json({ error: 'Cannot delete admin user' });
    }

    // Delete all products associated with this user
    const deletedProducts = await Product.deleteMany({ userId });

    // Delete all sales associated with this user
    const deletedSales = await Sale.deleteMany({ userId });

    // Delete the user
    await User.findByIdAndDelete(userId);

    res.json({
      message: 'User and all associated data deleted successfully',
      data: {
        userId,
        deletedProducts: deletedProducts.deletedCount,
        deletedSales: deletedSales.deletedCount,
      },
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete user' });
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

// Get schedule statistics
export const getScheduleStats = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Total schedules
    const totalSchedules = await Schedule.countDocuments();
    
    // Schedules by status
    const schedulesByStatus = await Schedule.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    // Schedules by frequency
    const schedulesByFrequency = await Schedule.aggregate([
      {
        $group: {
          _id: '$frequency',
          count: { $sum: 1 },
        },
      },
    ]);

    // Email notification statistics
    const emailStats = await Schedule.aggregate([
      {
        $group: {
          _id: null,
          totalWithNotifications: {
            $sum: {
              $cond: [{ $or: ['$notifyUser', '$notifyClient'] }, 1, 0],
            },
          },
          totalEmailsSent: {
            $sum: {
              $cond: [{ $ne: ['$lastNotified', null] }, 1, 0],
            },
          },
          schedulesWithUserNotification: {
            $sum: {
              $cond: ['$notifyUser', 1, 0],
            },
          },
          schedulesWithClientNotification: {
            $sum: {
              $cond: ['$notifyClient', 1, 0],
            },
          },
        },
      },
    ]);

    // Recent schedules (last N days)
    const recentSchedules = await Schedule.countDocuments({
      createdAt: { $gte: startDate },
    });

    // Schedules by user
    const schedulesByUser = await Schedule.aggregate([
      {
        $group: {
          _id: '$userId',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          emailsSent: {
            $sum: { $cond: [{ $ne: ['$lastNotified', null] }, 1, 0] },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          userId: '$_id',
          userName: { $ifNull: ['$user.name', 'Unknown'] },
          userEmail: { $ifNull: ['$user.email', 'N/A'] },
          count: 1,
          totalAmount: 1,
          completed: 1,
          emailsSent: 1,
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $limit: 10, // Top 10 users
      },
    ]);

    // Schedule activity over time (last N days)
    const scheduleActivity = await Schedule.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    // Email activity over time
    const emailActivity = await Schedule.aggregate([
      {
        $match: {
          lastNotified: { $gte: startDate, $ne: null },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$lastNotified',
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    // Upcoming schedules
    const now = new Date();
    const upcomingSchedules = await Schedule.countDocuments({
      status: 'pending',
      dueDate: { $gte: now },
    });

    // Overdue schedules
    const overdueSchedules = await Schedule.countDocuments({
      status: 'pending',
      dueDate: { $lt: now },
    });

    // Total amount in schedules
    const totalAmount = await Schedule.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]);

    const emailStatsData = emailStats[0] || {
      totalWithNotifications: 0,
      totalEmailsSent: 0,
      schedulesWithUserNotification: 0,
      schedulesWithClientNotification: 0,
    };

    res.json({
      data: {
        totalSchedules,
        schedulesByStatus: schedulesByStatus.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        schedulesByFrequency: schedulesByFrequency.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        emailStats: {
          totalWithNotifications: emailStatsData.totalWithNotifications,
          totalEmailsSent: emailStatsData.totalEmailsSent,
          schedulesWithUserNotification: emailStatsData.schedulesWithUserNotification,
          schedulesWithClientNotification: emailStatsData.schedulesWithClientNotification,
        },
        recentSchedules,
        schedulesByUser,
        scheduleActivity,
        emailActivity,
        upcomingSchedules,
        overdueSchedules,
        totalAmount: totalAmount[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error('Get schedule stats error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch schedule stats' });
  }
};

// Test email configuration
export const testEmail = async (req, res) => {
  try {
    const { to } = req.body;

    // Validate email address
    if (!to) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }

    // Check if SMTP is configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      return res.status(400).json({ 
        error: 'Email service not configured',
        message: 'Please configure SMTP_USER and SMTP_PASSWORD in your .env file'
      });
    }

    // Send test email
    const result = await sendEmail({
      to,
      subject: 'Test Email from Profit Pilot',
      text: 'This is a test email from Profit Pilot. If you receive this, your email configuration is working correctly!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Test Email from Profit Pilot</h2>
          <p>This is a test email from Profit Pilot.</p>
          <p>If you receive this, your email configuration is working correctly!</p>
          <p style="margin-top: 30px; color: #666; font-size: 12px;">
            This email was sent at ${new Date().toLocaleString()}
          </p>
        </div>
      `,
    });

    if (result.success) {
      res.json({
        message: 'Test email sent successfully',
        data: {
          to,
          messageId: result.messageId,
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      res.status(500).json({
        error: 'Failed to send test email',
        message: result.error || result.message,
      });
    }
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ error: error.message || 'Failed to send test email' });
  }
};
