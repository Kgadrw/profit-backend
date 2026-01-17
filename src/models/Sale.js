// Sale Model
import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema({
  product: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1'],
  },
  revenue: {
    type: Number,
    required: [true, 'Revenue is required'],
    min: [0, 'Revenue must be positive'],
  },
  cost: {
    type: Number,
    required: [true, 'Cost is required'],
    min: [0, 'Cost must be positive'],
  },
  profit: {
    type: Number,
    required: [true, 'Profit is required'],
  },
  date: {
    type: Date,
    required: [true, 'Sale date is required'],
    default: Date.now,
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'mobile', 'other'],
    default: 'cash',
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
saleSchema.index({ userId: 1, date: -1 });
saleSchema.index({ userId: 1, product: 1 });

const Sale = mongoose.model('Sale', saleSchema);

export default Sale;
