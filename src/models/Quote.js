import mongoose from 'mongoose';

const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 300 },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const quoteSchema = new mongoose.Schema(
  {
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
    quoteNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    dealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Deal',
      default: null,
      index: true,
    },
    clientName: { type: String, trim: true, maxlength: 200 },
    clientEmail: { type: String, trim: true, maxlength: 200 },
    clientPhone: { type: String, trim: true, maxlength: 50 },
    lineItems: { type: [lineItemSchema], default: [] },
    amount: { type: Number, required: true, min: 0 },
    issueDate: { type: Date, required: true, default: Date.now },
    validUntil: { type: Date },
    status: {
      type: String,
      enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
      default: 'draft',
      index: true,
    },
    notes: { type: String, trim: true },
    terms: { type: String, trim: true },
    convertedInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
  },
  { timestamps: true },
);

quoteSchema.index({ workspaceId: 1, status: 1 });

const Quote = mongoose.model('Quote', quoteSchema);

export default Quote;
