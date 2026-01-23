// Server Status Model - Tracks server uptime/downtime
import mongoose from 'mongoose';

const serverStatusSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['up', 'down'],
    required: true,
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
  duration: {
    type: Number, // Duration in seconds (for downtime periods)
    default: 0,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
serverStatusSchema.index({ timestamp: -1 });
serverStatusSchema.index({ status: 1, timestamp: -1 });

const ServerStatus = mongoose.model('ServerStatus', serverStatusSchema);

export default ServerStatus;
