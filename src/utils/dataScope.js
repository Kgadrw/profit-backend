import mongoose from 'mongoose';
import { canAccessWorkspacePage } from '../constants/workspacePermissions.js';

function isValidObjectId(value) {
  if (value == null) return false;
  const str = String(value);
  return mongoose.Types.ObjectId.isValid(str) && String(new mongoose.Types.ObjectId(str)) === str;
}

function toObjectId(value, label = 'id') {
  if (!isValidObjectId(value)) {
    const error = new Error(`Invalid ${label}`);
    error.statusCode = 400;
    throw error;
  }
  return new mongoose.Types.ObjectId(String(value));
}

function isAdminUser(req) {
  return Boolean(req.user?.isAdmin) || String(req.user?._id || '') === 'admin';
}

/** Match-nothing filter for callers with no personal data scope (e.g. admin). */
function emptyListQuery(extra = {}) {
  return { _id: { $in: [] }, ...extra };
}

/** Build MongoDB filter for list/read operations (personal vs workspace). */
export function buildListQuery(req, extra = {}) {
  const scope = req.dataScope;
  if (scope?.mode === 'workspace' && scope.workspaceId) {
    return {
      workspaceId: toObjectId(scope.workspaceId, 'workspace id'),
      ...extra,
    };
  }

  // Admin sessions use the literal id "admin" — they have no personal business data.
  if (isAdminUser(req)) {
    return emptyListQuery(extra);
  }

  const userId = req.user?._id;
  if (!userId) {
    throw new Error('User context required');
  }

  if (!isValidObjectId(userId)) {
    const error = new Error('Invalid user id');
    error.statusCode = 401;
    throw error;
  }

  return {
    userId: toObjectId(userId, 'user id'),
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

  if (isAdminUser(req) || !isValidObjectId(userId)) {
    const error = new Error('Admin cannot create personal business records. Sign in as a user.');
    error.statusCode = 403;
    throw error;
  }

  if (scope?.mode === 'workspace' && scope.workspaceId) {
    return {
      userId: toObjectId(userId, 'user id'),
      workspaceId: toObjectId(scope.workspaceId, 'workspace id'),
    };
  }

  return {
    userId: toObjectId(userId, 'user id'),
    workspaceId: null,
  };
}

export function buildActorFields(req, { isUpdate = false } = {}) {
  const user = req.user;
  if (!user?._id) return {};

  const name = user.name || (isAdminUser(req) ? 'Admin' : 'User');
  const actorId = isValidObjectId(user._id) ? user._id : undefined;

  if (isUpdate) {
    return {
      ...(actorId ? { updatedByUserId: actorId } : {}),
      updatedByName: name,
    };
  }

  return {
    ...(actorId ? { createdByUserId: actorId, updatedByUserId: actorId } : {}),
    createdByName: name,
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
