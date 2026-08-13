import mongoose from 'mongoose';
import { approvalFieldDefinitions } from '../utils/approvalFields.js';

const expenseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Expense title is required'],
      trim: true,
      maxlength: [200, 'Expense title must be at most 200 characters'],
    },
    amount: {
      type: Number,
      required: [true, 'Expense amount is required'],
      min: [0, 'Expense amount must be non-negative'],
    },
    quantity: {
      type: Number,
      min: [0.0001, 'Quantity must be greater than zero'],
      default: 1,
    },
    category: {
      type: String,
      trim: true,
      default: 'general',
      maxlength: [100, 'Category must be at most 100 characters'],
    },
    date: {
      type: Date,
      required: [true, 'Expense date is required'],
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000, 'Note must be at most 1000 characters'],
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
    },
    vendorName: {
      type: String,
      trim: true,
      maxlength: [200],
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
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
    },
    /** Optional second account (e.g. clearing / credited ledger account). */
    creditedAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
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
    reconciledAt: {
      type: Date,
    },
    ...approvalFieldDefinitions,
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
  {
    timestamps: true,
  }
);

expenseSchema.index({ userId: 1, date: -1 });
expenseSchema.index({ userId: 1, category: 1, date: -1 });
expenseSchema.index({ workspaceId: 1, date: -1 });

const Expense = mongoose.model('Expense', expenseSchema);

export default Expense;

