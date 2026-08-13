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
/** Throttle DB writes for lastSeenAt. */
const lastPersistedAt = new Map();
const PERSIST_THROTTLE_MS = 30_000;

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

async function persistLastSeen(userId, at = Date.now(), force = false) {
  const userKey = String(userId);
  const now = Date.now();
  const last = lastPersistedAt.get(userKey) || 0;
  if (!force && now - last < PERSIST_THROTTLE_MS) return;
  lastPersistedAt.set(userKey, now);
  try {
    await User.updateOne(
      { _id: userId },
      { $set: { lastSeenAt: new Date(at) } },
    );
  } catch {
    // Presence must not fail chat if lastSeen write fails.
  }
}

function getActiveUsers(workspaceId) {
  const room = workspacePresence.get(String(workspaceId));
  if (!room) return [];

  const now = Date.now();
  const active = [];
  const staleUserIds = [];

  for (const [userId, entry] of room.entries()) {
    if (now - entry.lastSeen > STALE_MS) {
      room.delete(userId);
      staleUserIds.push({ userId, lastSeen: entry.lastSeen });
      continue;
    }
    active.push({
      userId: entry.userId,
      userName: entry.userName,
      profilePictureUrl: entry.profilePictureUrl,
      lastSeen: entry.lastSeen,
    });
  }

  if (staleUserIds.length) {
    void Promise.all(
      staleUserIds.map(({ userId, lastSeen }) => persistLastSeen(userId, lastSeen, true)),
    );
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
  const now = Date.now();

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
    lastSeen: now,
  });

  void persistLastSeen(userId, now);
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
  void persistLastSeen(userId, entry.lastSeen);
  await broadcastPresence(workspaceId);
  return true;
}

export async function leaveWorkspacePresence(userId, workspaceId) {
  const workspaceKey = String(workspaceId);
  const userKey = String(userId);
  const room = workspacePresence.get(workspaceKey);
  if (!room?.has(userKey)) return;

  const entry = room.get(userKey);
  room.delete(userKey);
  if (room.size === 0) {
    workspacePresence.delete(workspaceKey);
  }

  await persistLastSeen(userId, entry?.lastSeen || Date.now(), true);
  await broadcastPresence(workspaceId, { force: true });
}

export async function leaveAllWorkspacePresence(userId) {
  const userKey = String(userId);
  const workspaceIds = [];
  let lastSeen = Date.now();

  for (const [workspaceId, room] of workspacePresence.entries()) {
    if (room.has(userKey)) {
      const entry = room.get(userKey);
      if (entry?.lastSeen) lastSeen = entry.lastSeen;
      room.delete(userKey);
      if (room.size === 0) {
        workspacePresence.delete(workspaceId);
      }
      workspaceIds.push(workspaceId);
    }
  }

  if (workspaceIds.length) {
    await persistLastSeen(userId, lastSeen, true);
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
    // Multi-workspace clients may leave one room while staying in others.
    if (String(ws.workspacePresenceId) === String(data.workspaceId)) {
      ws.workspacePresenceId = null;
    }
    await leaveWorkspacePresence(userId, data.workspaceId);
  }
}
