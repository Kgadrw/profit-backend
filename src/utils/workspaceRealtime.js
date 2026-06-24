import WorkspaceMember from '../models/WorkspaceMember.js';
import { emitToUser } from './websocket.js';

export function getActorFromRequest(req) {
  const user = req.user;
  return {
    userId: user?._id,
    name: user?.name || 'User',
  };
}

function enrichRealtimePayload(payload, actor) {
  const base =
    payload && typeof payload.toObject === 'function'
      ? payload.toObject()
      : { ...(payload || {}) };

  return {
    ...base,
    workspaceId: base.workspaceId ? String(base.workspaceId) : base.workspaceId ?? null,
    _actorUserId: String(actor.userId),
    _actorName: actor.name,
  };
}

/** Broadcast a data change to all workspace members (or the current user in personal mode). */
export async function broadcastScopeChange(req, event, payload) {
  const actor = getActorFromRequest(req);
  if (!actor.userId) return;

  const data = enrichRealtimePayload(payload, actor);
  const scope = req.dataScope;

  if (scope?.mode === 'workspace' && scope.workspaceId) {
    const members = await WorkspaceMember.find({ workspaceId: scope.workspaceId })
      .select('userId')
      .lean();

    const memberIds = [...new Set(members.map((m) => String(m.userId)))];
    await Promise.all(memberIds.map((userId) => Promise.resolve(emitToUser(userId, event, data))));
    return;
  }

  emitToUser(String(actor.userId), event, data);
}
