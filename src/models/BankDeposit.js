import mongoose from 'mongoose';

const bankDepositSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Deposit title is required'],
      trim: true,
      maxlength: [200, 'Deposit title must be at most 200 characters'],
    },
    amount: {
      type: Number,
      required: [true, 'Deposit amount is required'],
      min: [0, 'Deposit amount must be non-negative'],
    },
    depositDate: {
      type: Date,
      required: [true, 'Deposit date is required'],
      default: Date.now,
    },
    budgetPeriod: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly', 'custom'],
      default: 'monthly',
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
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
    referenceNumber: {
      type: String,
      trim: true,
      maxlength: [100],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000],
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
  {
    timestamps: true,
  }
);

bankDepositSchema.index({ userId: 1, depositDate: -1 });
bankDepositSchema.index({ userId: 1, periodStart: 1, periodEnd: 1 });

const BankDeposit = mongoose.model('BankDeposit', bankDepositSchema);

export default BankDeposit;
