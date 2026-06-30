// Client Model
import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Client name is required'],
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  phone: {
    type: String,
    trim: true,
  },
  businessType: {
    type: String,
    trim: true,
    default: 'General',
  },
  clientType: {
    type: String,
    enum: ['debtor', 'worker', 'other'],
    default: 'other',
  },
  workerStatus: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  discipline: {
    type: String,
    enum: ['excellent', 'good', 'fair', 'poor', 'warning'],
    default: 'good',
  },
  lastCheckIn: {
    type: Date,
  },
  lastCheckOut: {
    type: Date,
  },
  notes: {
    type: String,
    trim: true,
  },
  lifecycleStage: {
    type: String,
    enum: ['lead', 'prospect', 'customer', 'inactive'],
    default: 'lead',
    index: true,
  },
  source: {
    type: String,
    trim: true,
  },
  companyName: {
    type: String,
    trim: true,
  },
  address: {
    type: String,
    trim: true,
  },
  ownerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  tags: {
    type: [String],
    default: [],
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

// Index for faster queries
clientSchema.index({ userId: 1, name: 1 });
clientSchema.index({ userId: 1, email: 1 });

const Client = mongoose.model('Client', clientSchema);

export default Client;
