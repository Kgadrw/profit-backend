import mongoose from 'mongoose';

const loanPaymentSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: [0, 'Payment amount must be non-negative'],
    },
    paymentDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    principalPortion: {
      type: Number,
      min: 0,
      default: 0,
    },
    interestPortion: {
      type: Number,
      min: 0,
      default: 0,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [500],
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
    expenseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Expense',
    },
  },
  { timestamps: true },
);

const loanSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Loan title is required'],
      trim: true,
      maxlength: [200],
    },
    lender: {
      type: String,
      required: [true, 'Lender is required'],
      trim: true,
      maxlength: [200],
    },
    loanType: {
      type: String,
      trim: true,
      enum: ['business', 'working_capital', 'equipment', 'vehicle', 'line_of_credit', 'other'],
      default: 'business',
    },
    principalAmount: {
      type: Number,
      required: [true, 'Principal amount is required'],
      min: [0, 'Principal must be non-negative'],
    },
    interestRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    termMonths: {
      type: Number,
      min: 0,
    },
    installmentAmount: {
      type: Number,
      required: [true, 'Installment amount is required'],
      min: [0, 'Installment must be non-negative'],
    },
    paymentFrequency: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly'],
      default: 'monthly',
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    maturityDate: {
      type: Date,
    },
    nextDueDate: {
      type: Date,
      required: [true, 'Next due date is required'],
    },
    totalPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingBalance: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['active', 'paid_off', 'overdue'],
      default: 'active',
      index: true,
    },
    referenceNumber: {
      type: String,
      trim: true,
      maxlength: [100],
    },
    accountNumber: {
      type: String,
      trim: true,
      maxlength: [50],
    },
    collateral: {
      type: String,
      trim: true,
      maxlength: [500],
    },
    contactPerson: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    contactPhone: {
      type: String,
      trim: true,
      maxlength: [50],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000],
    },
    payments: [loanPaymentSchema],
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

loanSchema.index({ userId: 1, status: 1, nextDueDate: 1 });
loanSchema.index({ userId: 1, nextDueDate: -1 });

const Loan = mongoose.model('Loan', loanSchema);

export default Loan;
