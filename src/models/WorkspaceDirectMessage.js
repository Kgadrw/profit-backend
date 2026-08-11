import mongoose from 'mongoose';

const workspaceDirectMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkspaceDirectConversation',
      required: true,
      index: true,
    },
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
    editedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    unreadEmailRemindedUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true },
);

workspaceDirectMessageSchema.index({ conversationId: 1, createdAt: -1 });

const WorkspaceDirectMessage = mongoose.model(
  'WorkspaceDirectMessage',
  workspaceDirectMessageSchema,
);

export default WorkspaceDirectMessage;
