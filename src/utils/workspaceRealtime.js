import WorkspaceMember from '../models/WorkspaceMember.js';
import { emitToUser } from './websocket.js';

const memberIdsCache = new Map();
const MEMBER_CACHE_MS = 60_000;

async function getWorkspaceMemberIds(workspaceId) {
  const key = String(workspaceId);
  const cached = memberIdsCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.ids;
  }

  const members = await WorkspaceMember.find({ workspaceId })
    .select('userId')
    .lean();

  const ids = [...new Set(members.map((member) => String(member.userId)))];
  memberIdsCache.set(key, { ids, expires: Date.now() + MEMBER_CACHE_MS });
  return ids;
}

export function invalidateWorkspaceMemberCache(workspaceId) {
  if (workspaceId) {
    memberIdsCache.delete(String(workspaceId));
  }
}

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

/** Broadcast an event to every member of a workspace by workspace id. */
export async function broadcastToWorkspace(workspaceId, event, payload) {
  if (!workspaceId) return;

  const data =
    payload && typeof payload.toObject === 'function'
      ? {
          ...payload.toObject(),
          workspaceId: String(workspaceId),
        }
      : {
          ...(payload || {}),
          workspaceId: String(payload?.workspaceId || workspaceId),
        };

  const memberIds = await getWorkspaceMemberIds(workspaceId);
  await Promise.all(memberIds.map((userId) => Promise.resolve(emitToUser(userId, event, data))));
}
