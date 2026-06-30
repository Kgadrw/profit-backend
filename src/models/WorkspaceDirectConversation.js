import mongoose from 'mongoose';

const workspaceDirectConversationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    participantIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
      ],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length === 2;
        },
        message: 'A direct conversation must have exactly two participants',
      },
    },
    participantKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    lastMessageBody: {
      type: String,
      trim: true,
      default: '',
    },
    lastSenderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

workspaceDirectConversationSchema.index(
  { workspaceId: 1, participantKey: 1 },
  { unique: true },
);
workspaceDirectConversationSchema.index({ workspaceId: 1, lastMessageAt: -1 });

const WorkspaceDirectConversation = mongoose.model(
  'WorkspaceDirectConversation',
  workspaceDirectConversationSchema,
);

export default WorkspaceDirectConversation;
