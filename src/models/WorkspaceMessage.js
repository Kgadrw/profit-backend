import mongoose from 'mongoose';

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
