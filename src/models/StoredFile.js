import mongoose from 'mongoose';

const storedFileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['profile', 'receipt', 'document', 'workspace-profile', 'chat-attachment'],
      required: true,
    },
    filename: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 127,
    },
    data: {
      type: Buffer,
      required: true,
    },
    size: {
      type: Number,
      required: true,
      min: 0,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

storedFileSchema.index({ userId: 1, kind: 1, filename: 1 }, { unique: true });
storedFileSchema.index({ userId: 1, kind: 1 });

const StoredFile = mongoose.model('StoredFile', storedFileSchema);

export default StoredFile;
