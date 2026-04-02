// Notification Model
import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true,
  },
  sentBy: {
    // Used for admin notification history (who generated this notification)
    type: String,
    default: 'system',
    index: true,
  },
  type: {
    type: String,
    enum: ['new_user', 'low_stock', 'schedule', 'new_sale', 'new_product', 'general'],
    default: 'general',
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
  },
  body: {
    type: String,
    required: [true, 'Body is required'],
    trim: true,
  },
  icon: {
    type: String,
    default: '/logo.png',
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  read: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

// Index for efficient queries: user's notifications sorted by newest first
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ sentBy: 1, createdAt: -1 });

// Auto-delete notifications older than 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
