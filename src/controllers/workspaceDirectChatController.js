import mongoose from 'mongoose';
import WorkspaceMember from '../models/WorkspaceMember.js';
import WorkspaceDirectConversation from '../models/WorkspaceDirectConversation.js';
import WorkspaceDirectMessage from '../models/WorkspaceDirectMessage.js';
import User from '../models/User.js';
import { emitToUser } from '../utils/websocket.js';
import { notifyDirectMessagePush } from '../utils/pushNotifications.js';
import { saveStoredFile } from '../utils/storedFileService.js';
import { notifyDirectMessageRecipient } from '../utils/chatNotifications.js';
import Workspace from '../models/Workspace.js';
import WorkspaceMessage from '../models/WorkspaceMessage.js';
import {
  isAllowedDisappearingDuration,
  resolveExpiresAt,
} from '../utils/disappearingMessages.js';

export const WORKSPACE_DM_MESSAGE_EVENT = 'workspace-dm:message';
export const WORKSPACE_DM_READ_EVENT = 'workspace-dm:read';
export const WORKSPACE_DM_EDIT_EVENT = 'workspace-dm:edit';
export const WORKSPACE_DM_DELETE_EVENT = 'workspace-dm:delete';
export const WORKSPACE_DM_SETTINGS_EVENT = 'workspace-dm:settings';
export const WORKSPACE_DM_REACTION_EVENT = 'workspace-dm:reaction';

async function assertWorkspaceMember(workspaceId, userId) {
  const membership = await WorkspaceMember.findOne({ workspaceId, userId }).select('_id').lean();
  if (!membership) {
    const error = new Error('Not a member of this workspace');
    error.statusCode = 403;
    throw error;
  }
}

function buildParticipantKey(userIdA, userIdB) {
  const ids = [String(userIdA), String(userIdB)].sort();
  return `${ids[0]}:${ids[1]}`;
}

function getOtherParticipantId(conversation, currentUserId) {
  const other = (conversation.participantIds || []).find(
    (id) => String(id) !== String(currentUserId),
  );
  return other ? String(other) : null;
}

async function getNicknameMap(userId) {
  const user = await User.findById(userId).select('chatNicknames').lean();
  const map = new Map();
  for (const row of user?.chatNicknames || []) {
    if (row?.peerUserId && row?.nickname) {
      map.set(String(row.peerUserId), String(row.nickname).trim());
    }
  }
  return map;
}

function applyNickname(peer, nicknameMap) {
  if (!peer?.userId) return peer;
  const nickname = nicknameMap.get(String(peer.userId));
  if (!nickname) return { ...peer, nickname: null };
  return { ...peer, nickname, displayName: nickname };
}

async function findCommonWorkspaces(userIdA, userIdB) {
  const [mine, theirs] = await Promise.all([
    WorkspaceMember.find({ userId: userIdA }).select('workspaceId').lean(),
    WorkspaceMember.find({ userId: userIdB }).select('workspaceId').lean(),
  ]);
  const theirSet = new Set(theirs.map((row) => String(row.workspaceId)));
  const sharedIds = mine
    .map((row) => String(row.workspaceId))
    .filter((id) => theirSet.has(id));
  if (!sharedIds.length) return [];

  const workspaces = await Workspace.find({ _id: { $in: sharedIds } })
    .select('name profilePictureUrl')
    .lean();

  return workspaces.map((ws) => ({
    workspaceId: String(ws._id),
    name: ws.name || 'Workspace',
    profilePictureUrl: ws.profilePictureUrl || null,
  }));
}

async function getWorkspacePeers(workspaceId, currentUserId) {
  const members = await WorkspaceMember.find({ workspaceId }).select('userId').lean();
  const peerIds = members
    .map((member) => String(member.userId))
    .filter((userId) => userId !== String(currentUserId));

  if (!peerIds.length) return [];

  const [users, nicknameMap] = await Promise.all([
    User.find({ _id: { $in: peerIds } })
      .select('name email profilePictureUrl lastSeenAt')
      .lean(),
    getNicknameMap(currentUserId),
  ]);

  return users.map((user) =>
    applyNickname(
      {
        userId: String(user._id),
        name: user.name || 'User',
        email: user.email || '',
        profilePictureUrl: user.profilePictureUrl || null,
        lastSeenAt: user.lastSeenAt ? new Date(user.lastSeenAt).toISOString() : null,
      },
      nicknameMap,
    ),
  );
}

async function assertConversationAccess(conversationId, workspaceId, userId) {
  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    const error = new Error('Invalid conversation id');
    error.statusCode = 400;
    throw error;
  }

  const conversation = await WorkspaceDirectConversation.findOne({
    _id: conversationId,
    workspaceId,
  }).lean();

  if (!conversation) {
    const error = new Error('Conversation not found');
    error.statusCode = 404;
    throw error;
  }

  const isParticipant = (conversation.participantIds || []).some(
    (participantId) => String(participantId) === String(userId),
  );

  if (!isParticipant) {
    const error = new Error('Not a participant in this conversation');
    error.statusCode = 403;
    throw error;
  }

  return conversation;
}

async function broadcastToConversation(conversation, event, payload) {
  const participantIds = (conversation.participantIds || []).map((id) => String(id));
  await Promise.all(
    participantIds.map((userId) => Promise.resolve(emitToUser(userId, event, payload))),
  );
}

async function countUnreadForConversation(conversationId, userId) {
  return WorkspaceDirectMessage.countDocuments({
    conversationId,
    senderUserId: { $ne: userId },
    'readBy.userId': { $ne: userId },
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
  });
}

async function buildDirectChatThreadsForWorkspace(workspaceId, userId, workspaceMeta = {}) {
  const [peers, conversations] = await Promise.all([
    getWorkspacePeers(workspaceId, userId),
    WorkspaceDirectConversation.find({
      workspaceId,
      participantIds: userId,
    })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean(),
  ]);

  const conversationByPeerId = new Map();
  for (const conversation of conversations) {
    const otherUserId = getOtherParticipantId(conversation, userId);
    if (otherUserId) {
      conversationByPeerId.set(otherUserId, conversation);
    }
  }

  const threads = await Promise.all(
    peers.map(async (peer) => {
      const conversation = conversationByPeerId.get(peer.userId);
      const unreadCount = conversation
        ? await countUnreadForConversation(conversation._id, userId)
        : 0;

      return {
        conversationId: conversation ? String(conversation._id) : null,
        workspaceId: String(workspaceMeta.workspaceId || workspaceId),
        workspaceName: workspaceMeta.workspaceName || 'Workspace',
        otherUser: peer,
        lastMessageAt: conversation?.lastMessageAt || null,
        lastMessageBody: conversation?.lastMessageBody || null,
        lastSenderUserId: conversation?.lastSenderUserId
          ? String(conversation.lastSenderUserId)
          : null,
        unreadCount,
        disappearingDurationSec: Number(conversation?.disappearingDurationSec) || 0,
      };
    }),
  );

  threads.sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.otherUser.name.localeCompare(b.otherUser.name);
  });

  return threads;
}

function normalizeWaveform(raw) {
  if (!Array.isArray(raw)) return undefined;
  const peaks = raw
    .slice(0, 64)
    .map((value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(1, n));
    });
  return peaks.length ? peaks : undefined;
}

function normalizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return [];
  return rawAttachments
    .slice(0, 5)
    .map((item) => {
      const durationRaw = Number(item?.duration);
      const duration =
        Number.isFinite(durationRaw) && durationRaw > 0 ? Math.min(durationRaw, 3600) : undefined;
      const waveform = normalizeWaveform(item?.waveform);
      return {
        url: String(item?.url || '').trim(),
        fileName: String(item?.fileName || '').trim(),
        mimeType: String(item?.mimeType || 'application/octet-stream').trim(),
        size: Number(item?.size) || 0,
        ...(duration != null ? { duration } : {}),
        ...(waveform ? { waveform } : {}),
      };
    })
    .filter((item) => item.url && item.fileName);
}

function normalizePoll(rawPoll) {
  if (!rawPoll || typeof rawPoll !== 'object') return null;
  const question = String(rawPoll.question || '').trim().slice(0, 500);
  const options = Array.isArray(rawPoll.options)
    ? rawPoll.options
        .map((option) => String(typeof option === 'string' ? option : option?.text || '').trim().slice(0, 280))
        .filter(Boolean)
    : [];
  if (!question || options.length < 2 || options.length > 10 || new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    return null;
  }
  return { question, options: options.map((text) => ({ text, voterIds: [] })) };
}

function serializePoll(poll) {
  if (!poll) return null;
  return {
    question: poll.question,
    options: (poll.options || []).map((option) => ({
      text: option.text,
      voteCount: (option.voterIds || []).length,
      voterIds: (option.voterIds || []).map((id) => String(id)),
    })),
  };
}

function serializeReactions(reactions) {
  return (reactions || [])
    .filter((reaction) => reaction?.emoji && reaction.userIds?.length)
    .map((reaction) => ({
      emoji: String(reaction.emoji),
      userIds: (reaction.userIds || []).map((id) => String(id)),
    }));
}

function normalizeReactionEmoji(rawEmoji) {
  const emoji = String(rawEmoji || '').trim();
  if (!emoji || emoji.length > 32 || [...emoji].length > 8) return null;
  return emoji;
}

function buildLastMessagePreview(body, attachments, deletedAt, replyTo) {
  if (deletedAt) return 'Message deleted';
  const trimmedBody = String(body || '').trim();
  let preview = trimmedBody;
  if (!preview && attachments?.length) {
    const first = attachments[0];
    if (first.mimeType?.startsWith('image/')) preview = '📷 Photo';
    else if (first.mimeType?.startsWith('audio/') || /\.(webm|ogg|mp3|m4a|aac|wav)$/i.test(first.fileName || '')) {
      preview = '🎤 Voice message';
    } else preview = `📎 ${first.fileName}`;
  }
  if (!preview) return '';

  if (replyTo?.messageId) {
    const replyName = String(replyTo.senderName || '').trim();
    return replyName ? `↩ ${replyName}: ${preview}` : `↩ ${preview}`;
  }
  return preview;
}

async function refreshConversationPreview(conversationId) {
  const last = await WorkspaceDirectMessage.findOne({ conversationId })
    .sort({ createdAt: -1 })
    .lean();

  if (!last) {
    await WorkspaceDirectConversation.updateOne(
      { _id: conversationId },
      { lastMessageAt: null, lastMessageBody: '', lastSenderUserId: null },
    );
    return;
  }

  const preview = buildLastMessagePreview(
    last.body,
    last.attachments,
    last.deletedAt,
    last.replyTo,
  );
  await WorkspaceDirectConversation.updateOne(
    { _id: conversationId },
    {
      lastMessageAt: last.createdAt,
      lastMessageBody: preview,
      lastSenderUserId: last.senderUserId,
    },
  );
}

function serializeDirectMessage(message, conversationId, workspaceId) {
  const replyTo = message.replyTo?.messageId
    ? {
        messageId: String(message.replyTo.messageId),
        senderUserId: message.replyTo.senderUserId
          ? String(message.replyTo.senderUserId)
          : null,
        senderName: message.replyTo.senderName || 'User',
        body: message.replyTo.body || '',
        deletedAt: message.replyTo.deletedAt || null,
      }
    : null;

  return {
    ...message,
    _id: String(message._id),
    conversationId: String(conversationId),
    workspaceId: String(workspaceId),
    senderUserId: String(message.senderUserId),
    replyTo,
    poll: serializePoll(message.poll),
    reactions: serializeReactions(message.reactions),
    systemType: message.systemType || null,
    systemPayload: message.systemPayload || null,
    expiresAt: message.expiresAt ? new Date(message.expiresAt).toISOString() : null,
  };
}

function buildReplyToSnapshot(sourceMessage) {
  if (!sourceMessage) return null;
  const deleted = Boolean(sourceMessage.deletedAt);
  return {
    messageId: sourceMessage._id,
    senderUserId: sourceMessage.senderUserId,
    senderName: sourceMessage.senderName || 'User',
    body: deleted ? '' : String(sourceMessage.body || '').trim().slice(0, 280),
    deletedAt: sourceMessage.deletedAt || null,
  };
}

function normalizeClientReplyTo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const messageId = raw.messageId || raw._id;
  if (!messageId || !mongoose.Types.ObjectId.isValid(String(messageId))) return null;
  const senderUserId = raw.senderUserId ? String(raw.senderUserId) : '';
  return {
    messageId: new mongoose.Types.ObjectId(String(messageId)),
    senderUserId:
      senderUserId && mongoose.Types.ObjectId.isValid(senderUserId)
        ? new mongoose.Types.ObjectId(senderUserId)
        : null,
    senderName: String(raw.senderName || 'User').trim() || 'User',
    body: String(raw.body || '').trim().slice(0, 280),
    deletedAt: raw.deletedAt ? new Date(raw.deletedAt) : null,
  };
}

async function resolveDirectReplyTo(conversationId, workspaceId, replyToMessageId) {
  if (!replyToMessageId) return null;
  if (!mongoose.Types.ObjectId.isValid(String(replyToMessageId))) {
    return null;
  }

  const source = await WorkspaceDirectMessage.findOne({
    _id: replyToMessageId,
    conversationId,
    workspaceId,
  }).lean();

  if (!source) return null;
  return buildReplyToSnapshot(source);
}

function attachReplyToCreateData(createData, replyTo) {
  if (!replyTo?.messageId) return createData;
  return {
    ...createData,
    replyTo: {
      messageId: replyTo.messageId,
      senderUserId: replyTo.senderUserId || null,
      senderName: replyTo.senderName || 'User',
      body: replyTo.body || '',
      deletedAt: replyTo.deletedAt || null,
    },
  };
}

export const uploadDirectChatAttachment = async (req, res) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    await assertConversationAccess(conversationId, workspaceId, userId);

    const { url } = await saveStoredFile({
      userId,
      kind: 'chat-attachment',
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      workspaceId,
      conversationId,
    });

    res.status(201).json({
      data: {
        url,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });
  } catch (error) {
    console.error('Upload direct chat attachment error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to upload attachment' });
  }
};

export const listDirectChatThreads = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    await assertWorkspaceMember(workspaceId, userId);

    const workspace = await Workspace.findById(workspaceId).select('name').lean();
    const threads = await buildDirectChatThreadsForWorkspace(workspaceId, userId, {
      workspaceId: String(workspaceId),
      workspaceName: workspace?.name || 'Workspace',
    });

    res.json({ data: threads });
  } catch (error) {
    console.error('List direct chat threads error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load chats' });
  }
};

/** Inbox across every organisation the user has joined (no active-workspace switch required). */
export const listAllDirectChatThreads = async (req, res) => {
  try {
    const userId = req.user._id;
    const memberships = await WorkspaceMember.find({ userId }).select('workspaceId').lean();
    if (!memberships.length) {
      return res.json({ data: [] });
    }

    const workspaceIds = memberships.map((row) => row.workspaceId);
    const workspaces = await Workspace.find({ _id: { $in: workspaceIds } })
      .select('name')
      .lean();
    const nameById = new Map(
      workspaces.map((row) => [String(row._id), row.name || 'Workspace']),
    );

    const nested = await Promise.all(
      workspaceIds.map((workspaceId) =>
        buildDirectChatThreadsForWorkspace(workspaceId, userId, {
          workspaceId: String(workspaceId),
          workspaceName: nameById.get(String(workspaceId)) || 'Workspace',
        }),
      ),
    );

    const threads = nested.flat().sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      const orgCmp = String(a.workspaceName || '').localeCompare(String(b.workspaceName || ''));
      if (orgCmp !== 0) return orgCmp;
      return a.otherUser.name.localeCompare(b.otherUser.name);
    });

    res.json({ data: threads });
  } catch (error) {
    console.error('List all direct chat threads error:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to load chats',
    });
  }
};

export const openDirectChat = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { otherUserId } = req.body || {};
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    if (!otherUserId || !mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ error: 'otherUserId is required' });
    }

    if (String(otherUserId) === String(userId)) {
      return res.status(400).json({ error: 'Cannot start a chat with yourself' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    await assertWorkspaceMember(workspaceId, otherUserId);

    const participantIds = [userId, otherUserId].sort((a, b) =>
      String(a).localeCompare(String(b)),
    );
    const participantKey = buildParticipantKey(userId, otherUserId);

    let conversation = await WorkspaceDirectConversation.findOne({
      workspaceId,
      participantKey,
    }).lean();

    if (!conversation) {
      const created = await WorkspaceDirectConversation.create({
        workspaceId,
        participantIds,
        participantKey,
        lastMessageAt: null,
        lastMessageBody: '',
        lastSenderUserId: null,
      });
      conversation = created.toObject();
    }

    const otherUser = await User.findById(otherUserId)
      .select('name email profilePictureUrl lastSeenAt')
      .lean();
    const nicknameMap = await getNicknameMap(userId);
    const peer = applyNickname(
      {
        userId: String(otherUserId),
        name: otherUser?.name || 'User',
        email: otherUser?.email || '',
        profilePictureUrl: otherUser?.profilePictureUrl || null,
        lastSeenAt: otherUser?.lastSeenAt
          ? new Date(otherUser.lastSeenAt).toISOString()
          : null,
      },
      nicknameMap,
    );

    res.json({
      data: {
        conversationId: String(conversation._id),
        disappearingDurationSec: Number(conversation.disappearingDurationSec) || 0,
        otherUser: peer,
      },
    });
  } catch (error) {
    console.error('Open direct chat error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to open chat' });
  }
};

export const getDirectChatMessages = async (req, res) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    await assertConversationAccess(conversationId, workspaceId, userId);

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const before = req.query.before;

    const now = new Date();
    const query = {
      conversationId,
      workspaceId,
      $and: [
        { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] },
        { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
      ],
    };
    if (before) {
      const beforeDate = new Date(before);
      if (!Number.isNaN(beforeDate.getTime())) {
        query.createdAt = { $lt: beforeDate };
      }
    }

    const messages = await WorkspaceDirectMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      data: messages
        .reverse()
        .map((row) => serializeDirectMessage(row, conversationId, workspaceId)),
    });
  } catch (error) {
    console.error('Get direct chat messages error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load messages' });
  }
};

export const sendDirectChatMessage = async (req, res) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const { body, attachments: rawAttachments, replyToMessageId, replyTo: clientReplyTo, poll: rawPoll } =
      req.body || {};
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    const trimmedBody = String(body || '').trim();
    const attachments = normalizeAttachments(rawAttachments);
    const poll = rawPoll === undefined ? null : normalizePoll(rawPoll);

    if (rawPoll !== undefined && !poll) {
      return res.status(400).json({ error: 'Poll requires a question and 2-10 unique options' });
    }
    if (!trimmedBody && !attachments.length && !poll) {
      return res.status(400).json({ error: 'Message, attachment, or poll is required' });
    }

    const user = await User.findById(userId).select('name profilePictureUrl');
    if (!user) {
      return res.status(401).json({ error: 'User not found. Please login again.' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    const conversation = await assertConversationAccess(conversationId, workspaceId, userId);
    // Prefer the client snapshot (what the user saw), fall back to DB lookup.
    const replyTo =
      normalizeClientReplyTo(clientReplyTo) ||
      (await resolveDirectReplyTo(conversationId, workspaceId, replyToMessageId));

    for (const attachment of attachments) {
      const expectedPrefix = `/api/files/chat-attachments/${workspaceId}/${conversationId}/`;
      if (!attachment.url.startsWith(expectedPrefix)) {
        return res.status(400).json({ error: 'Invalid attachment reference' });
      }
    }

    const expiresAt = resolveExpiresAt(conversation.disappearingDurationSec);
    const createData = attachReplyToCreateData(
      {
        conversationId,
        workspaceId,
        senderUserId: user._id,
        senderName: user.name || 'User',
        senderProfilePictureUrl: user.profilePictureUrl || null,
        body: trimmedBody,
        attachments,
        ...(poll ? { poll } : {}),
        readBy: [],
        expiresAt,
      },
      replyTo,
    );

    const created = await WorkspaceDirectMessage.create(createData);
    const saved =
      (await WorkspaceDirectMessage.findById(created._id).lean()) || created.toObject();

    const payload = serializeDirectMessage(saved, conversationId, workspaceId);
    // Guarantee reply quote survives even if mongoose omitted the nested path.
    if (!payload.replyTo?.messageId && replyTo?.messageId) {
      payload.replyTo = {
        messageId: String(replyTo.messageId),
        senderUserId: replyTo.senderUserId ? String(replyTo.senderUserId) : null,
        senderName: replyTo.senderName || 'User',
        body: replyTo.body || '',
        deletedAt: replyTo.deletedAt || null,
      };
    }

    const preview = buildLastMessagePreview(
      trimmedBody,
      attachments,
      null,
      payload.replyTo || replyTo || saved.replyTo,
    );
    const now = saved.createdAt || new Date();
    await WorkspaceDirectConversation.updateOne(
      { _id: conversationId },
      {
        lastMessageAt: now,
        lastMessageBody: preview,
        lastSenderUserId: user._id,
      },
    );

    await broadcastToConversation(conversation, WORKSPACE_DM_MESSAGE_EVENT, payload);

    const recipientId = getOtherParticipantId(conversation, userId);
    if (recipientId) {
      void notifyDirectMessagePush({
        recipientUserId: recipientId,
        workspaceId,
        message: payload,
      }).catch((pushError) => {
        console.error('Direct message push error:', pushError);
      });

      void Workspace.findById(workspaceId)
        .select('name')
        .lean()
        .then((workspace) =>
          notifyDirectMessageRecipient({
            workspaceId,
            workspaceName: workspace?.name || 'Workspace',
            message: payload,
            recipientUserId: recipientId,
            otherUserIdForRoute: String(user._id),
          }),
        )
        .catch((error) => {
          console.error('Direct message in-app notification error:', error);
        });
    }

    res.status(201).json({ data: payload });
  } catch (error) {
    console.error('Send direct chat message error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to send message' });
  }
};

export const voteDirectChatMessagePoll = async (req, res) => {
  try {
    const { workspaceId, conversationId, messageId } = req.params;
    const optionIndex = Number(req.body?.optionIndex);
    const userId = req.user._id;
    if (!mongoose.Types.ObjectId.isValid(workspaceId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid workspace or message id' });
    }
    await assertWorkspaceMember(workspaceId, userId);
    const conversation = await assertConversationAccess(conversationId, workspaceId, userId);
    const message = await WorkspaceDirectMessage.findOne({ _id: messageId, conversationId, workspaceId });
    if (!message || message.deletedAt) return res.status(404).json({ error: 'Message not found' });
    if (!message.poll || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= message.poll.options.length) {
      return res.status(400).json({ error: 'Invalid poll option' });
    }
    for (const option of message.poll.options) {
      option.voterIds = option.voterIds.filter((id) => String(id) !== String(userId));
    }
    message.poll.options[optionIndex].voterIds.push(userId);
    message.markModified('poll');
    await message.save();
    const payload = serializeDirectMessage(message.toObject(), conversationId, workspaceId);
    await broadcastToConversation(conversation, WORKSPACE_DM_EDIT_EVENT, payload);
    res.json({ data: payload });
  } catch (error) {
    console.error('Vote direct chat poll error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to vote on poll' });
  }
};

export const toggleDirectChatMessageReaction = async (req, res) => {
  try {
    const { workspaceId, conversationId, messageId } = req.params;
    const userId = req.user._id;
    const emoji = normalizeReactionEmoji(req.body?.emoji);
    if (!mongoose.Types.ObjectId.isValid(workspaceId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid workspace or message id' });
    }
    if (!emoji) return res.status(400).json({ error: 'A valid emoji is required' });
    await assertWorkspaceMember(workspaceId, userId);
    const conversation = await assertConversationAccess(conversationId, workspaceId, userId);
    const message = await WorkspaceDirectMessage.findOne({ _id: messageId, conversationId, workspaceId });
    if (!message || message.deletedAt || (message.expiresAt && message.expiresAt <= new Date())) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const reactions = Array.isArray(message.reactions) ? message.reactions : [];
    const reaction = reactions.find((row) => row.emoji === emoji);
    if (reaction) {
      const alreadyReacted = reaction.userIds.some((id) => String(id) === String(userId));
      reaction.userIds = alreadyReacted
        ? reaction.userIds.filter((id) => String(id) !== String(userId))
        : [...reaction.userIds, userId];
    } else {
      reactions.push({ emoji, userIds: [userId] });
    }
    message.reactions = reactions.filter((row) => row.userIds?.length);
    message.markModified('reactions');
    await message.save();
    const payload = serializeDirectMessage(message.toObject(), conversationId, workspaceId);
    await broadcastToConversation(conversation, WORKSPACE_DM_REACTION_EVENT, payload);
    res.json({ data: payload });
  } catch (error) {
    console.error('Toggle direct message reaction error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to react to message' });
  }
};

export const markDirectChatMessagesRead = async (req, res) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const { messageIds } = req.body || {};
    const user = req.user;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds is required' });
    }

    const validIds = messageIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!validIds.length) {
      return res.status(400).json({ error: 'No valid message ids' });
    }

    await assertWorkspaceMember(workspaceId, user._id);
    const conversation = await assertConversationAccess(conversationId, workspaceId, user._id);

    const readEntry = {
      userId: user._id,
      userName: user.name || 'User',
      readAt: new Date(),
    };

    const candidateMessages = await WorkspaceDirectMessage.find({
      conversationId,
      _id: { $in: validIds },
      senderUserId: { $ne: user._id },
    })
      .select('_id readBy')
      .lean();

    const idsToUpdate = candidateMessages
      .filter(
        (message) =>
          !message.readBy?.some((entry) => String(entry.userId) === String(user._id)),
      )
      .map((message) => message._id);

    if (idsToUpdate.length) {
      await WorkspaceDirectMessage.updateMany(
        {
          conversationId,
          _id: { $in: idsToUpdate },
          'readBy.userId': { $ne: user._id },
        },
        { $push: { readBy: readEntry } },
      );
    }

    const updated = idsToUpdate.length
      ? await WorkspaceDirectMessage.find({ _id: { $in: idsToUpdate } }).lean()
      : [];

    if (updated.length) {
      const payloadList = updated.map((message) => ({
        ...message,
        conversationId: String(conversationId),
        workspaceId: String(workspaceId),
      }));

      await Promise.all(
        payloadList.map((message) =>
          broadcastToConversation(conversation, WORKSPACE_DM_READ_EVENT, message),
        ),
      );
    }

    res.json({ data: updated });
  } catch (error) {
    console.error('Mark direct chat messages read error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to mark messages read' });
  }
};

export const editDirectChatMessage = async (req, res) => {
  try {
    const { workspaceId, conversationId, messageId } = req.params;
    const { body } = req.body || {};
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const trimmedBody = String(body || '').trim();
    if (!trimmedBody) {
      return res.status(400).json({ error: 'Message body is required' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    const conversation = await assertConversationAccess(conversationId, workspaceId, userId);

    const message = await WorkspaceDirectMessage.findOne({
      _id: messageId,
      conversationId,
      workspaceId,
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (String(message.senderUserId) !== String(userId)) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }

    if (message.deletedAt) {
      return res.status(400).json({ error: 'Deleted messages cannot be edited' });
    }

    message.body = trimmedBody;
    message.editedAt = new Date();
    await message.save();

    await refreshConversationPreview(conversationId);

    const payload = serializeDirectMessage(message.toObject(), conversationId, workspaceId);
    await broadcastToConversation(conversation, WORKSPACE_DM_EDIT_EVENT, payload);

    res.json({ data: message });
  } catch (error) {
    console.error('Edit direct chat message error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to edit message' });
  }
};

export const deleteDirectChatMessage = async (req, res) => {
  try {
    const { workspaceId, conversationId, messageId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    const conversation = await assertConversationAccess(conversationId, workspaceId, userId);

    const message = await WorkspaceDirectMessage.findOne({
      _id: messageId,
      conversationId,
      workspaceId,
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (String(message.senderUserId) !== String(userId)) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    if (message.deletedAt) {
      return res.status(400).json({ error: 'Message is already deleted' });
    }

    message.deletedAt = new Date();
    message.body = '';
    message.attachments = [];
    message.poll = undefined;
    message.reactions = [];
    await message.save();

    await refreshConversationPreview(conversationId);

    const payload = serializeDirectMessage(message.toObject(), conversationId, workspaceId);
    await broadcastToConversation(conversation, WORKSPACE_DM_DELETE_EVENT, payload);

    res.json({ data: message });
  } catch (error) {
    console.error('Delete direct chat message error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to delete message' });
  }
};

export const getChatUnreadSummary = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    await assertWorkspaceMember(workspaceId, userId);

    const [groupUnread, conversations] = await Promise.all([
      WorkspaceMessage.countDocuments({
        workspaceId,
        senderUserId: { $ne: userId },
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
        'readBy.userId': { $ne: userId },
      }),
      WorkspaceDirectConversation.find({
        workspaceId,
        participantIds: userId,
      })
        .select('_id')
        .lean(),
    ]);

    let directUnread = 0;
    if (conversations.length) {
      const counts = await Promise.all(
        conversations.map((row) => countUnreadForConversation(row._id, userId)),
      );
      directUnread = counts.reduce((sum, value) => sum + value, 0);
    }

    res.json({
      data: {
        groupUnread,
        directUnread,
        total: groupUnread + directUnread,
      },
    });
  } catch (error) {
    console.error('Get chat unread summary error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load unread summary' });
  }
};

/** Unread totals across every organisation the user has joined. */
export const getAllChatUnreadSummary = async (req, res) => {
  try {
    const userId = req.user._id;
    const memberships = await WorkspaceMember.find({ userId }).select('workspaceId').lean();
    if (!memberships.length) {
      return res.json({
        data: { groupUnread: 0, directUnread: 0, total: 0 },
      });
    }

    const workspaceIds = memberships.map((row) => row.workspaceId);

    const [groupUnread, conversations] = await Promise.all([
      WorkspaceMessage.countDocuments({
        workspaceId: { $in: workspaceIds },
        senderUserId: { $ne: userId },
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
        'readBy.userId': { $ne: userId },
      }),
      WorkspaceDirectConversation.find({
        workspaceId: { $in: workspaceIds },
        participantIds: userId,
      })
        .select('_id')
        .lean(),
    ]);

    let directUnread = 0;
    if (conversations.length) {
      const counts = await Promise.all(
        conversations.map((row) => countUnreadForConversation(row._id, userId)),
      );
      directUnread = counts.reduce((sum, value) => sum + value, 0);
    }

    res.json({
      data: {
        groupUnread,
        directUnread,
        total: groupUnread + directUnread,
      },
    });
  } catch (error) {
    console.error('Get all chat unread summary error:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to load unread summary',
    });
  }
};

/** Chat info: peer profile, nickname, disappearing setting, groups in common. */
export const getDirectChatInfo = async (req, res) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    const conversation = await assertConversationAccess(conversationId, workspaceId, userId);
    const otherUserId = getOtherParticipantId(conversation, userId);
    if (!otherUserId) {
      return res.status(404).json({ error: 'Peer not found' });
    }

    const [otherUser, nicknameMap, commonWorkspaces] = await Promise.all([
      User.findById(otherUserId).select('name email phone profilePictureUrl lastSeenAt').lean(),
      getNicknameMap(userId),
      findCommonWorkspaces(userId, otherUserId),
    ]);

    const peer = applyNickname(
      {
        userId: otherUserId,
        name: otherUser?.name || 'User',
        email: otherUser?.email || '',
        phone: otherUser?.phone || '',
        profilePictureUrl: otherUser?.profilePictureUrl || null,
        lastSeenAt: otherUser?.lastSeenAt
          ? new Date(otherUser.lastSeenAt).toISOString()
          : null,
      },
      nicknameMap,
    );

    res.json({
      data: {
        conversationId: String(conversation._id),
        workspaceId: String(workspaceId),
        disappearingDurationSec: Number(conversation.disappearingDurationSec) || 0,
        otherUser: peer,
        commonWorkspaces,
      },
    });
  } catch (error) {
    console.error('Get direct chat info error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load chat info' });
  }
};

export const updateDirectChatDisappearing = async (req, res) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const userId = req.user._id;
    const durationSec = Number(req.body?.disappearingDurationSec);

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }
    if (!isAllowedDisappearingDuration(durationSec)) {
      return res.status(400).json({ error: 'Invalid disappearing duration' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    const conversation = await assertConversationAccess(conversationId, workspaceId, userId);

    await WorkspaceDirectConversation.updateOne(
      { _id: conversationId },
      { disappearingDurationSec: durationSec },
    );

    const actor = await User.findById(userId).select('name profilePictureUrl').lean();
    const actorName = actor?.name || req.user.name || 'User';
    const noticeBody =
      durationSec > 0
        ? `${actorName} turned on disappearing messages (${durationSec}s).`
        : `${actorName} turned off disappearing messages.`;

    const notice = await WorkspaceDirectMessage.create({
      conversationId,
      workspaceId,
      senderUserId: userId,
      senderName: actorName,
      senderProfilePictureUrl: actor?.profilePictureUrl || null,
      body: noticeBody,
      systemType: 'disappearing',
      systemPayload: { durationSec },
      readBy: [
        {
          userId,
          userName: actorName,
          readAt: new Date(),
        },
      ],
    });

    await refreshConversationPreview(conversationId);

    const messagePayload = serializeDirectMessage(
      notice.toObject ? notice.toObject() : notice,
      conversationId,
      workspaceId,
    );
    await broadcastToConversation(conversation, WORKSPACE_DM_MESSAGE_EVENT, messagePayload);

    const payload = {
      workspaceId: String(workspaceId),
      conversationId: String(conversationId),
      disappearingDurationSec: durationSec,
      updatedByUserId: String(userId),
      updatedByName: actorName,
    };
    await broadcastToConversation(conversation, WORKSPACE_DM_SETTINGS_EVENT, payload);

    res.json({ data: { ...payload, notice: messagePayload } });
  } catch (error) {
    console.error('Update direct chat disappearing error:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to update disappearing messages',
    });
  }
};

export const updateChatNickname = async (req, res) => {
  try {
    const peerUserId = String(req.params.peerUserId || '');
    const nickname = String(req.body?.nickname || '').trim().slice(0, 40);
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(peerUserId)) {
      return res.status(400).json({ error: 'Invalid peer user id' });
    }
    if (String(peerUserId) === String(userId)) {
      return res.status(400).json({ error: 'Cannot nickname yourself' });
    }

    const user = await User.findById(userId).select('chatNicknames');
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const list = Array.isArray(user.chatNicknames) ? [...user.chatNicknames] : [];
    const idx = list.findIndex((row) => String(row.peerUserId) === peerUserId);
    if (!nickname) {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      list[idx].nickname = nickname;
    } else {
      list.push({ peerUserId, nickname });
    }
    user.chatNicknames = list;
    await user.save();

    res.json({
      data: {
        peerUserId,
        nickname: nickname || null,
      },
    });
  } catch (error) {
    console.error('Update chat nickname error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update nickname' });
  }
};

/** Soft-delete expired disappearing DMs and notify participants. */
export async function purgeExpiredDirectMessages() {
  const now = new Date();
  const expired = await WorkspaceDirectMessage.find({
    expiresAt: { $ne: null, $lte: now },
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
  })
    .limit(200)
    .lean();

  if (!expired.length) return 0;

  const conversationCache = new Map();
  let purged = 0;

  for (const message of expired) {
    await WorkspaceDirectMessage.updateOne(
      { _id: message._id },
      {
        deletedAt: now,
        body: '',
        attachments: [],
        poll: undefined,
        reactions: [],
      },
    );

    const conversationId = String(message.conversationId);
    let conversation = conversationCache.get(conversationId);
    if (!conversation) {
      conversation = await WorkspaceDirectConversation.findById(conversationId).lean();
      if (conversation) conversationCache.set(conversationId, conversation);
    }

    if (conversation) {
      const payload = serializeDirectMessage(
        { ...message, deletedAt: now, body: '', attachments: [], poll: undefined, reactions: [] },
        conversationId,
        message.workspaceId,
      );
      await broadcastToConversation(conversation, WORKSPACE_DM_DELETE_EVENT, payload);
      await refreshConversationPreview(conversationId);
    }
    purged += 1;
  }

  return purged;
}
