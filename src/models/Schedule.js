// Schedule Model
import mongoose from 'mongoose';

const scheduleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Schedule title is required'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
  },
  dueDate: {
    type: Date,
    required: [true, 'Due date is required'],
  },
  frequency: {
    type: String,
    enum: ['once', 'daily', 'weekly', 'monthly', 'yearly'],
    default: 'once',
  },
  amount: {
    type: Number,
    min: [0, 'Amount must be positive'],
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending',
  },
  
  // Notification settings
  notifyUser: {
    type: Boolean,
    default: true,
  },
  notifyClient: {
    type: Boolean,
    default: false,
  },
  userNotificationMessage: {
    type: String,
    trim: true,
  },
  clientNotificationMessage: {
    type: String,
    trim: true,
  },
  
  // Advanced settings
  advanceNotificationDays: {
    type: Number,
    default: 0,
    min: [0, 'Advance notification days cannot be negative'],
  },
  repeatUntil: {
    type: Date,
  },
  
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lastNotified: {
    type: Date,
  },
  nextDueDate: {
    type: Date, // Calculated field for recurring schedules
  },
}, {
  timestamps: true,
});

// Index for faster queries
scheduleSchema.index({ userId: 1, dueDate: 1 });
scheduleSchema.index({ userId: 1, status: 1 });
scheduleSchema.index({ userId: 1, clientId: 1 });
scheduleSchema.index({ dueDate: 1, status: 1 }); // For scheduler queries

const Schedule = mongoose.model('Schedule', scheduleSchema);

export default Schedule;
