// Sale Model
import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema({
  saleType: {
    type: String,
    enum: ['product', 'service'],
    default: 'product',
    index: true,
  },
  product: {
    type: String,
    trim: true,
    // Required only if not a service
    required: function() {
      return !this.isService;
    },
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  },
  // Service-related fields
  isService: {
    type: Boolean,
    default: false,
  },
  serviceName: {
    type: String,
    trim: true,
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
  },
  workerName: {
    type: String,
    trim: true,
  },
  customAmount: {
    type: Number,
    min: [0, 'Custom amount must be positive'],
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1'],
    default: 1, // Services typically have quantity of 1
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
    default: 0, // Services may have no cost
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
    enum: ['cash', 'card', 'momo', 'airtel', 'transfer'],
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
saleSchema.index({ userId: 1, saleType: 1, date: -1 });
saleSchema.index({ userId: 1, isService: 1, date: -1 });
saleSchema.index({ userId: 1, workerId: 1, date: -1 });
saleSchema.index({ userId: 1, serviceId: 1 });

const Sale = mongoose.model('Sale', saleSchema);

export default Sale;
