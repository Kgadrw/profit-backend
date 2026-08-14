import mongoose from 'mongoose';

const incomeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Income title is required'],
      trim: true,
      maxlength: [200, 'Income title must be at most 200 characters'],
    },
    amount: {
      type: Number,
      required: [true, 'Income amount is required'],
      min: [0, 'Income amount must be non-negative'],
    },
    category: {
      type: String,
      trim: true,
      default: 'general',
      maxlength: [100, 'Category must be at most 100 characters'],
    },
    source: {
      type: String,
      trim: true,
      default: 'general',
      maxlength: [100, 'Income source must be at most 100 characters'],
    },
    date: {
      type: Date,
      required: [true, 'Income date is required'],
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000, 'Note must be at most 1000 characters'],
    },
    isRecurring: {
      type: Boolean,
      default: false,
      index: true,
    },
    recurrenceFrequency: {
      type: String,
      enum: ['weekly', 'monthly', 'yearly', ''],
      default: '',
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
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
    },
    reconciledAt: {
      type: Date,
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
  {
    timestamps: true,
  }
);

incomeSchema.index({ userId: 1, date: -1 });
incomeSchema.index({ userId: 1, source: 1, date: -1 });
incomeSchema.index({ workspaceId: 1, date: -1 });

const Income = mongoose.model('Income', incomeSchema);

export default Income;
