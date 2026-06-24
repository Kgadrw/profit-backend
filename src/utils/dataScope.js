import mongoose from 'mongoose';
import { canAccessWorkspacePage } from '../constants/workspacePermissions.js';

/** Build MongoDB filter for list/read operations (personal vs workspace). */
export function buildListQuery(req, extra = {}) {
  const scope = req.dataScope;
  if (scope?.mode === 'workspace' && scope.workspaceId) {
    return {
      workspaceId: new mongoose.Types.ObjectId(scope.workspaceId),
      ...extra,
    };
  }

  const userId = req.user?._id;
  if (!userId) {
    throw new Error('User context required');
  }

  return {
    userId: new mongoose.Types.ObjectId(userId),
    $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }],
    ...extra,
  };
}

/** Fields to set when creating records in the active scope. */
export function buildCreateScope(req) {
  const scope = req.dataScope;
  const userId = req.user?._id;
  if (!userId) {
    throw new Error('User context required');
  }

  if (scope?.mode === 'workspace' && scope.workspaceId) {
    return {
      userId: new mongoose.Types.ObjectId(userId),
      workspaceId: new mongoose.Types.ObjectId(scope.workspaceId),
    };
  }

  return {
    userId: new mongoose.Types.ObjectId(userId),
    workspaceId: null,
  };
}

export function buildActorFields(req, { isUpdate = false } = {}) {
  const user = req.user;
  if (!user?._id) return {};

  const name = user.name || 'User';

  if (isUpdate) {
    return {
      updatedByUserId: user._id,
      updatedByName: name,
    };
  }

  return {
    createdByUserId: user._id,
    createdByName: name,
    updatedByUserId: user._id,
    updatedByName: name,
  };
}

export function assertPageAccess(req, pageKey) {
  const scope = req.dataScope;
  if (!scope || scope.mode !== 'workspace') {
    return true;
  }
  if (canAccessWorkspacePage(scope.role, scope.permissions, pageKey)) {
    return true;
  }
  // Dashboard overview may read summaries (GET only) for widgets the user cannot manage
  const isReadRequest = req.method === 'GET' || req.method === 'HEAD';
  if (
    isReadRequest &&
    pageKey !== 'dashboard' &&
    canAccessWorkspacePage(scope.role, scope.permissions, 'dashboard')
  ) {
    return true;
  }
  const error = new Error(`You do not have access to ${pageKey} in this workspace`);
  error.statusCode = 403;
  throw error;
}
