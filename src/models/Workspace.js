import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Workspace name is required'],
    trim: true,
    maxlength: 120,
  },
  profilePictureUrl: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  /** Group chat disappearing messages timer in seconds. 0 = off. */
  groupDisappearingDurationSec: {
    type: Number,
    default: 0,
    min: 0,
  },
}, {
  timestamps: true,
});

workspaceSchema.index({ name: 1, ownerId: 1 });

const Workspace = mongoose.model('Workspace', workspaceSchema);

export default Workspace;
