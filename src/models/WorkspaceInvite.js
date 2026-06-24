import mongoose from 'mongoose';
import crypto from 'crypto';
import { ALL_WORKSPACE_PAGE_KEYS } from '../constants/workspacePermissions.js';

const workspaceInviteSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  role: {
    type: String,
    enum: ['admin', 'member'],
    default: 'member',
  },
  permissions: {
    type: [String],
    default: [],
    validate: {
      validator(values) {
        return values.every((v) => ALL_WORKSPACE_PAGE_KEYS.includes(v));
      },
      message: 'Invalid page permission',
    },
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'revoked', 'expired'],
    default: 'pending',
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 },
  },
}, {
  timestamps: true,
});

workspaceInviteSchema.statics.generateToken = function generateToken() {
  return crypto.randomBytes(24).toString('hex');
};

const WorkspaceInvite = mongoose.model('WorkspaceInvite', workspaceInviteSchema);

export default WorkspaceInvite;
