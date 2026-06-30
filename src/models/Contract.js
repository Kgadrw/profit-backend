import mongoose from 'mongoose';

const contractSchema = new mongoose.Schema(
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
    title: {
      type: String,
      required: [true, 'Contract title is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'expired', 'terminated'],
      default: 'draft',
      index: true,
    },
    startDate: { type: Date },
    endDate: { type: Date },
    renewalDate: { type: Date },
    value: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

contractSchema.index({ workspaceId: 1, status: 1 });

const Contract = mongoose.model('Contract', contractSchema);

export default Contract;
