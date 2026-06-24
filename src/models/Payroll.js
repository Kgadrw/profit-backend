import mongoose from 'mongoose';

const payrollSchema = new mongoose.Schema(
  {
    employeeName: {
      type: String,
      required: [true, 'Employee name is required'],
      trim: true,
      maxlength: [200],
    },
    amount: {
      type: Number,
      required: [true, 'Payroll amount is required'],
      min: [0, 'Amount must be non-negative'],
    },
    period: {
      type: String,
      required: [true, 'Pay period is required'],
      trim: true,
      maxlength: [20],
    },
    paymentDate: {
      type: Date,
      required: [true, 'Payment date is required'],
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['paid', 'pending'],
      default: 'paid',
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

payrollSchema.index({ userId: 1, paymentDate: -1 });
payrollSchema.index({ userId: 1, period: -1 });

const Payroll = mongoose.model('Payroll', payrollSchema);

export default Payroll;
