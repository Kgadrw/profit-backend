import mongoose from 'mongoose';

const dealSchema = new mongoose.Schema(
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
    title: {
      type: String,
      required: [true, 'Deal title is required'],
      trim: true,
    },
    stage: {
      type: String,
      enum: ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'],
      default: 'lead',
      index: true,
    },
    value: {
      type: Number,
      default: 0,
      min: 0,
    },
    probability: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },
    expectedCloseDate: {
      type: Date,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    lostReason: {
      type: String,
      trim: true,
    },
    wonAt: {
      type: Date,
    },
    lostAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

dealSchema.index({ workspaceId: 1, stage: 1 });

const Deal = mongoose.model('Deal', dealSchema);

export default Deal;
