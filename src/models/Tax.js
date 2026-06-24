import mongoose from 'mongoose';

const taxSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Tax title is required'],
      trim: true,
      maxlength: [200],
    },
    taxType: {
      type: String,
      required: [true, 'Tax type is required'],
      trim: true,
      maxlength: [100],
    },
    amount: {
      type: Number,
      required: [true, 'Tax amount is required'],
      min: [0, 'Amount must be non-negative'],
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
    },
    period: {
      type: String,
      trim: true,
      maxlength: [50],
    },
    authority: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    referenceNumber: {
      type: String,
      trim: true,
      maxlength: [100],
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
      default: 'transfer',
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

taxSchema.index({ userId: 1, status: 1, dueDate: 1 });
taxSchema.index({ userId: 1, dueDate: -1 });

const Tax = mongoose.model('Tax', taxSchema);

export default Tax;
