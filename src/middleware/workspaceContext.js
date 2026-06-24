import mongoose from 'mongoose';
import WorkspaceMember from '../models/WorkspaceMember.js';
import { normalizePermissions } from '../constants/workspacePermissions.js';

/**
 * Resolves personal vs workspace data scope from headers:
 * - X-Workspace-Mode: personal | workspace (default personal)
 * - X-Workspace-Id: required when mode is workspace
 */
export async function resolveWorkspaceContext(req, res, next) {
  try {
    const modeHeader = String(req.headers['x-workspace-mode'] || 'personal').toLowerCase();
    const workspaceIdHeader = req.headers['x-workspace-id'];

    if (modeHeader !== 'workspace' || !workspaceIdHeader) {
      req.dataScope = { mode: 'personal' };
      return next();
    }

    if (!mongoose.Types.ObjectId.isValid(workspaceIdHeader)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    const userId = req.user?._id;
    if (!userId || userId === 'admin') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const membership = await WorkspaceMember.findOne({
      workspaceId: workspaceIdHeader,
      userId,
    }).lean();

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    req.dataScope = {
      mode: 'workspace',
      workspaceId: String(workspaceIdHeader),
      role: membership.role,
      permissions: normalizePermissions(membership.permissions, membership.role),
      membershipId: String(membership._id),
    };

    return next();
  } catch (error) {
    console.error('Workspace context error:', error);
    return res.status(500).json({ error: 'Failed to resolve workspace context' });
  }
}

export function requireWorkspaceAdmin(req, res, next) {
  const scope = req.workspaceAdminScope || req.dataScope;
  const role = scope?.role;
  if (role !== 'owner' && role !== 'admin') {
    return res.status(403).json({ error: 'Workspace admin access required' });
  }
  return next();
}
