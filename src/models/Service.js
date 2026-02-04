// Service Model
import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Service name is required'],
    trim: true,
  },
  category: {
    type: String,
    trim: true,
  },
  defaultPrice: {
    type: Number,
    min: [0, 'Default price must be positive'],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Index for faster queries
serviceSchema.index({ userId: 1, isActive: 1 });
serviceSchema.index({ userId: 1, name: 1 });
serviceSchema.index({ userId: 1, category: 1 });

const Service = mongoose.model('Service', serviceSchema);

export default Service;
