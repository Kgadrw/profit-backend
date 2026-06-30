import mongoose from 'mongoose';
import { WORKSPACE_CATEGORY_TYPES } from '../constants/workspaceCategories.js';

const workspaceCategorySchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: WORKSPACE_CATEGORY_TYPES,
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

workspaceCategorySchema.index(
  { workspaceId: 1, type: 1, key: 1 },
  { unique: true, partialFilterExpression: { workspaceId: { $type: 'objectId' } } },
);
workspaceCategorySchema.index(
  { userId: 1, type: 1, key: 1 },
  { unique: true, partialFilterExpression: { workspaceId: null } },
);

const WorkspaceCategory = mongoose.model('WorkspaceCategory', workspaceCategorySchema);

export default WorkspaceCategory;
