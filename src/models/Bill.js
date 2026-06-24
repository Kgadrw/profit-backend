import mongoose from 'mongoose';

const billSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Bill title is required'],
      trim: true,
      maxlength: [200],
    },
    amount: {
      type: Number,
      required: [true, 'Bill amount is required'],
      min: [0, 'Amount must be non-negative'],
    },
    vendor: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
    },
    category: {
      type: String,
      trim: true,
      default: 'bills',
      maxlength: [100],
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
    },
    status: {
      type: String,
      enum: ['pending', 'paid'],
      default: 'pending',
      index: true,
    },
    paidAt: {
      type: Date,
    },
    expenseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Expense',
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000],
    },
    paymentMethod: {
      type: String,
      trim: true,
      enum: ['cash', 'momo', 'airtel', 'card', 'transfer', 'other'],
      default: 'cash',
    },
    bankAccountName: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    bankAccountNumber: {
      type: String,
      trim: true,
      maxlength: [50],
    },
    receiptUrl: {
      type: String,
      trim: true,
      maxlength: [500],
    },
    receiptFileName: {
      type: String,
      trim: true,
      maxlength: [255],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

billSchema.index({ userId: 1, status: 1, dueDate: 1 });
billSchema.index({ userId: 1, dueDate: -1 });
billSchema.index({ userId: 1, vendorId: 1 });

const Bill = mongoose.model('Bill', billSchema);

export default Bill;
