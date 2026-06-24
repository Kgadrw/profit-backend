import mongoose from 'mongoose';

const lineItemSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: [300],
    },
    quantity: {
      type: Number,
      default: 1,
      min: 0,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: [50],
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200],
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      index: true,
    },
    clientName: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    clientEmail: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    clientPhone: {
      type: String,
      trim: true,
      maxlength: [50],
    },
    lineItems: {
      type: [lineItemSchema],
      default: [],
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    issueDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'paid', 'overdue'],
      default: 'draft',
      index: true,
    },
    sentAt: {
      type: Date,
    },
    paidAt: {
      type: Date,
    },
    incomeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Income',
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000],
    },
    terms: {
      type: String,
      trim: true,
      maxlength: [1000],
    },
    isRecurring: {
      type: Boolean,
      default: false,
    },
    recurrenceFrequency: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly'],
    },
    recurrenceEndDate: {
      type: Date,
    },
    parentInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
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

invoiceSchema.index({ userId: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ userId: 1, clientId: 1, issueDate: -1 });
invoiceSchema.index({ userId: 1, invoiceNumber: 1 }, { unique: true });

const Invoice = mongoose.model('Invoice', invoiceSchema);

export default Invoice;
