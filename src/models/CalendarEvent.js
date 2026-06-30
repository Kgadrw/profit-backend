// Calendar Event Model — business activities, meetings, deadlines, etc.
import mongoose from 'mongoose';

const calendarEventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Event title is required'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  eventType: {
    type: String,
    enum: ['meeting', 'activity', 'appointment', 'deadline', 'event', 'reminder', 'other'],
    default: 'event',
  },
  startDate: {
    type: Date,
    required: [true, 'Start date is required'],
  },
  endDate: {
    type: Date,
  },
  allDay: {
    type: Boolean,
    default: false,
  },
  location: {
    type: String,
    trim: true,
  },
  color: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'cancelled'],
    default: 'scheduled',
  },
  reminderMinutes: {
    type: Number,
    min: [0, 'Reminder minutes cannot be negative'],
    default: 0,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    default: null,
    index: true,
  },
  clientName: {
    type: String,
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    default: null,
    index: true,
  },
}, {
  timestamps: true,
});

calendarEventSchema.index({ userId: 1, startDate: 1 });
calendarEventSchema.index({ userId: 1, status: 1 });

const CalendarEvent = mongoose.model('CalendarEvent', calendarEventSchema);

export default CalendarEvent;
