// Product Model
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true,
  },
  costPrice: {
    type: Number,
    required: [true, 'Cost price is required'],
    min: [0, 'Cost price must be positive'],
  },
  sellingPrice: {
    type: Number,
    required: [true, 'Selling price is required'],
    min: [0, 'Selling price must be positive'],
  },
  stock: {
    type: Number,
    required: [true, 'Stock is required'],
    min: [0, 'Stock cannot be negative'],
    default: 0,
  },
  isPackage: {
    type: Boolean,
    default: false,
  },
  packageQuantity: {
    type: Number,
    min: [1, 'Package quantity must be at least 1'],
  },
  productType: {
    type: String,
    trim: true,
  },
  minStock: {
    type: Number,
    min: [0, 'Minimum stock cannot be negative'],
    default: 0,
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
productSchema.index({ userId: 1, name: 1 });
productSchema.index({ userId: 1, category: 1 });

const Product = mongoose.model('Product', productSchema);

export default Product;
