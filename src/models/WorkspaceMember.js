import mongoose from 'mongoose';
import { ALL_WORKSPACE_PAGE_KEYS } from '../constants/workspacePermissions.js';

const workspaceMemberSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'member'],
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
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true,
});

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

const WorkspaceMember = mongoose.model('WorkspaceMember', workspaceMemberSchema);

export default WorkspaceMember;
