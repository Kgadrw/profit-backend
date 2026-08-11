import WorkspaceMember from '../models/WorkspaceMember.js';
import WorkspaceDirectConversation from '../models/WorkspaceDirectConversation.js';
import User from '../models/User.js';
import { emitToUser } from './websocket.js';

export const WORKSPACE_CHAT_TYPING_EVENT = 'workspace-chat:typing';
export const WORKSPACE_DM_TYPING_EVENT = 'workspace-dm:typing';

async function assertWorkspaceMember(workspaceId, userId) {
  const membership = await WorkspaceMember.findOne({ workspaceId, userId }).select('_id').lean();
  return Boolean(membership);
}

async function resolveUserName(userId, fallback) {
  if (fallback && String(fallback).trim()) return String(fallback).trim();
  const user = await User.findById(userId).select('name').lean();
  return user?.name || 'User';
}

/** Group chat typing → fan out to workspace members (except sender). */
async function handleGroupTyping(ws, data) {
  const userId = ws.userId;
  const workspaceId = data?.workspaceId;
  if (!userId || !workspaceId) return;

  const isMember = await assertWorkspaceMember(workspaceId, userId);
  if (!isMember) return;

  const userName = await resolveUserName(userId, data.userName);
  const payload = {
    workspaceId: String(workspaceId),
    userId: String(userId),
    userName,
    isTyping: Boolean(data.isTyping),
  };

  const members = await WorkspaceMember.find({ workspaceId }).select('userId').lean();
  const recipientIds = [
    ...new Set(
      members
        .map((row) => String(row.userId))
        .filter((id) => id && id !== String(userId)),
    ),
  ];

  await Promise.all(
    recipientIds.map((recipientId) =>
      Promise.resolve(emitToUser(recipientId, WORKSPACE_CHAT_TYPING_EVENT, payload)),
    ),
  );
}

/** DM typing → other participant(s), via conversation or peer user id. */
async function handleDirectTyping(ws, data) {
  const userId = ws.userId;
  const workspaceId = data?.workspaceId;
  if (!userId || !workspaceId) return;

  const isMember = await assertWorkspaceMember(workspaceId, userId);
  if (!isMember) return;

  const userName = await resolveUserName(userId, data.userName);
  let conversationId = data.conversationId ? String(data.conversationId) : null;
  let recipientIds = [];

  if (conversationId) {
    const conversation = await WorkspaceDirectConversation.findOne({
      _id: conversationId,
      workspaceId,
    })
      .select('participantIds')
      .lean();
    if (!conversation) return;

    const isParticipant = (conversation.participantIds || []).some(
      (participantId) => String(participantId) === String(userId),
    );
    if (!isParticipant) return;

    recipientIds = (conversation.participantIds || [])
      .map((id) => String(id))
      .filter((id) => id && id !== String(userId));
  } else if (data.peerUserId) {
    const peerUserId = String(data.peerUserId);
    if (peerUserId === String(userId)) return;

    const peerIsMember = await assertWorkspaceMember(workspaceId, peerUserId);
    if (!peerIsMember) return;

    recipientIds = [peerUserId];
  } else {
    return;
  }

  const payload = {
    workspaceId: String(workspaceId),
    conversationId,
    peerUserId: String(userId),
    userId: String(userId),
    userName,
    isTyping: Boolean(data.isTyping),
  };

  await Promise.all(
    recipientIds.map((recipientId) =>
      Promise.resolve(emitToUser(recipientId, WORKSPACE_DM_TYPING_EVENT, payload)),
    ),
  );
}

export async function handleWorkspaceChatTypingMessage(ws, data) {
  if (!data?.type) return;

  if (data.type === WORKSPACE_CHAT_TYPING_EVENT) {
    await handleGroupTyping(ws, data);
    return;
  }

  if (data.type === WORKSPACE_DM_TYPING_EVENT) {
    await handleDirectTyping(ws, data);
  }
}
