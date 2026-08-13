import mongoose from 'mongoose';

const replyToSchema = new mongoose.Schema(
  {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    senderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    senderName: {
      type: String,
      trim: true,
      default: 'User',
    },
    body: {
      type: String,
      trim: true,
      maxlength: 280,
      default: '',
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const workspaceMessageSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    senderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderName: {
      type: String,
      required: true,
      trim: true,
    },
    senderProfilePictureUrl: {
      type: String,
      trim: true,
      default: null,
    },
    body: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: '',
    },
    attachments: [
      {
        url: { type: String, required: true, trim: true },
        fileName: { type: String, required: true, trim: true },
        mimeType: { type: String, required: true, trim: true },
        size: { type: Number, min: 0, default: 0 },
        duration: { type: Number, min: 0, default: undefined },
        waveform: { type: [Number], default: undefined },
      },
    ],
    replyTo: {
      type: replyToSchema,
      default: undefined,
    },
    mentionAll: {
      type: Boolean,
      default: false,
    },
    mentions: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        userName: {
          type: String,
          trim: true,
          default: 'User',
        },
      },
    ],
    editedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    deliveredTo: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        userName: {
          type: String,
          trim: true,
          default: 'User',
        },
        deliveredAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    readBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        userName: {
          type: String,
          trim: true,
          default: 'User',
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    unreadEmailRemindedUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true },
);

workspaceMessageSchema.index({ workspaceId: 1, createdAt: -1 });

const WorkspaceMessage = mongoose.model('WorkspaceMessage', workspaceMessageSchema);

export default WorkspaceMessage;
