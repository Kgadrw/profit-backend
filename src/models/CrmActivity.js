import mongoose from 'mongoose';

const crmActivitySchema = new mongoose.Schema(
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
    activityType: {
      type: String,
      enum: ['note', 'call', 'email', 'meeting', 'message'],
      default: 'note',
      index: true,
    },
    channel: {
      type: String,
      enum: ['internal', 'phone', 'email', 'sms', 'whatsapp', 'in_person', 'other'],
      default: 'internal',
    },
    subject: {
      type: String,
      trim: true,
    },
    body: {
      type: String,
      trim: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    createdByName: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

crmActivitySchema.index({ clientId: 1, occurredAt: -1 });

const CrmActivity = mongoose.model('CrmActivity', crmActivitySchema);

export default CrmActivity;
