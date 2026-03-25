// Notification Controller
import Notification from '../models/Notification.js';
import mongoose from 'mongoose';

// Helper to get userId from request
const getUserId = (req) => {
  const userIdFromHeader = req.headers['x-user-id'];
  if (userIdFromHeader && mongoose.Types.ObjectId.isValid(userIdFromHeader)) {
    return userIdFromHeader;
  }
  return null;
};

// Get all notifications for the current user
export const getNotifications = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'User not found. Please login first.' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const skip = parseInt(req.query.skip) || 0;

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const unreadCount = await Notification.countDocuments({ userId, read: false });

    res.json({ data: notifications, unreadCount });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// Create a notification
export const createNotification = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'User not found. Please login first.' });
    }

    // Policy: users should not create their own notifications.
    // Notifications should only be created by admin (via admin endpoints).
    return res.status(403).json({ error: 'Notifications can only be sent by admin.' });

    const { type, title, body, icon, data } = req.body;

    const notification = new Notification({
      userId,
      type: type || 'general',
      title,
      body,
      icon,
      data,
    });

    await notification.save();

    res.status(201).json({
      message: 'Notification created',
      data: notification,
    });
  } catch (error) {
    console.error('Create notification error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create notification' });
  }
};

// Mark a single notification as read
export const markAsRead = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'User not found. Please login first.' });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { read: true } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read', data: notification });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'User not found. Please login first.' });
    }

    await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true } }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
};

// Delete a single notification
export const deleteNotification = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'User not found. Please login first.' });
    }

    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId,
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

// Clear all notifications for the current user
export const clearAll = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'User not found. Please login first.' });
    }

    await Notification.deleteMany({ userId });

    res.json({ message: 'All notifications cleared' });
  } catch (error) {
    console.error('Clear all notifications error:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
};
