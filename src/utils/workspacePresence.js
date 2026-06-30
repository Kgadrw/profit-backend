import WorkspaceMember from '../models/WorkspaceMember.js';
import User from '../models/User.js';
import { broadcastToWorkspace } from './workspaceRealtime.js';
import { emitToUser } from './websocket.js';

export const WORKSPACE_PRESENCE_UPDATE_EVENT = 'workspace:presence:update';

/** @type {Map<string, Map<string, { userId: string, userName: string, profilePictureUrl: string | null, lastSeen: number }>>} */
const workspacePresence = new Map();

const STALE_MS = 60_000;
const BROADCAST_THROTTLE_MS = 3_000;
const lastBroadcastAt = new Map();

async function assertWorkspaceMember(workspaceId, userId) {
  const membership = await WorkspaceMember.findOne({ workspaceId, userId }).select('_id').lean();
  return Boolean(membership);
}

async function resolveUserProfile(userId) {
  const user = await User.findById(userId).select('name profilePictureUrl').lean();
  return {
    userName: user?.name || 'User',
    profilePictureUrl: user?.profilePictureUrl || null,
  };
}

function getActiveUsers(workspaceId) {
  const room = workspacePresence.get(String(workspaceId));
  if (!room) return [];

  const now = Date.now();
  const active = [];

  for (const [userId, entry] of room.entries()) {
    if (now - entry.lastSeen > STALE_MS) {
      room.delete(userId);
      continue;
    }
    active.push({
      userId: entry.userId,
      userName: entry.userName,
      profilePictureUrl: entry.profilePictureUrl,
    });
  }

  if (room.size === 0) {
    workspacePresence.delete(String(workspaceId));
  }

  return active.sort((a, b) => a.userName.localeCompare(b.userName));
}

async function broadcastPresence(workspaceId, options = {}) {
  const { force = false } = options;
  const workspaceKey = String(workspaceId);
  const now = Date.now();
  const lastAt = lastBroadcastAt.get(workspaceKey) || 0;

  if (!force && now - lastAt < BROADCAST_THROTTLE_MS) {
    return getActiveUsers(workspaceId);
  }

  const activeUsers = getActiveUsers(workspaceId);
  lastBroadcastAt.set(workspaceKey, now);

  await broadcastToWorkspace(workspaceId, WORKSPACE_PRESENCE_UPDATE_EVENT, {
    workspaceId: workspaceKey,
    activeUsers,
  });

  return activeUsers;
}

async function sendPresenceSnapshot(userId, workspaceId) {
  const activeUsers = getActiveUsers(workspaceId);
  emitToUser(String(userId), WORKSPACE_PRESENCE_UPDATE_EVENT, {
    workspaceId: String(workspaceId),
    activeUsers,
  });
}

export async function joinWorkspacePresence(userId, workspaceId, profile = {}) {
  if (!userId || !workspaceId) return false;

  const isMember = await assertWorkspaceMember(workspaceId, userId);
  if (!isMember) return false;

  const resolved = await resolveUserProfile(userId);
  const workspaceKey = String(workspaceId);
  const userKey = String(userId);

  if (!workspacePresence.has(workspaceKey)) {
    workspacePresence.set(workspaceKey, new Map());
  }

  workspacePresence.get(workspaceKey).set(userKey, {
    userId: userKey,
    userName: profile.userName || resolved.userName,
    profilePictureUrl:
      profile.profilePictureUrl !== undefined
        ? profile.profilePictureUrl
        : resolved.profilePictureUrl,
    lastSeen: Date.now(),
  });

  await broadcastPresence(workspaceId, { force: true });
  await sendPresenceSnapshot(userId, workspaceId);
  return true;
}

export async function touchWorkspacePresence(userId, workspaceId) {
  const workspaceKey = String(workspaceId);
  const userKey = String(userId);
  const room = workspacePresence.get(workspaceKey);
  const entry = room?.get(userKey);
  if (!entry) return false;

  entry.lastSeen = Date.now();
  await broadcastPresence(workspaceId);
  return true;
}

export async function leaveWorkspacePresence(userId, workspaceId) {
  const workspaceKey = String(workspaceId);
  const userKey = String(userId);
  const room = workspacePresence.get(workspaceKey);
  if (!room?.has(userKey)) return;

  room.delete(userKey);
  if (room.size === 0) {
    workspacePresence.delete(workspaceKey);
  }

  await broadcastPresence(workspaceId, { force: true });
}

export async function leaveAllWorkspacePresence(userId) {
  const userKey = String(userId);
  const workspaceIds = [];

  for (const [workspaceId, room] of workspacePresence.entries()) {
    if (room.has(userKey)) {
      room.delete(userKey);
      if (room.size === 0) {
        workspacePresence.delete(workspaceId);
      }
      workspaceIds.push(workspaceId);
    }
  }

  await Promise.all(
    workspaceIds.map((workspaceId) => broadcastPresence(workspaceId, { force: true })),
  );
}

export async function handleWorkspacePresenceMessage(ws, data) {
  const userId = ws.userId;
  if (!userId || !data?.workspaceId) return;

  if (data.type === 'workspace:presence:join') {
    const joined = await joinWorkspacePresence(userId, data.workspaceId, {
      userName: data.userName,
      profilePictureUrl: data.profilePictureUrl,
    });
    if (joined) {
      ws.workspacePresenceId = String(data.workspaceId);
    }
    return;
  }

  if (data.type === 'workspace:presence:heartbeat') {
    const touched = await touchWorkspacePresence(userId, data.workspaceId);
    if (!touched) {
      await joinWorkspacePresence(userId, data.workspaceId, {
        userName: data.userName,
        profilePictureUrl: data.profilePictureUrl,
      });
    }
    return;
  }

  if (data.type === 'workspace:presence:leave') {
    ws.workspacePresenceId = null;
    await leaveWorkspacePresence(userId, data.workspaceId);
  }
}
