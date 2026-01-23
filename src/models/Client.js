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
    required: [true, 'Client email is required'],
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
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
    required: [true, 'Business type is required'],
    trim: true,
  },
  clientType: {
    type: String,
    enum: ['debtor', 'worker', 'other'],
    default: 'other',
  },
  notes: {
    type: String,
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Index for faster queries
clientSchema.index({ userId: 1, name: 1 });
clientSchema.index({ userId: 1, email: 1 });

const Client = mongoose.model('Client', clientSchema);

export default Client;
