import mongoose from 'mongoose';
import WorkspaceMessage from '../models/WorkspaceMessage.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import Workspace from '../models/Workspace.js';
import User from '../models/User.js';
import { broadcastToWorkspace } from '../utils/workspaceRealtime.js';
import { notifyWorkspaceChatPush } from '../utils/pushNotifications.js';
import { notifyWorkspaceGroupMessageRecipients } from '../utils/chatNotifications.js';
import { saveStoredFile } from '../utils/storedFileService.js';
import {
  isAllowedDisappearingDuration,
} from '../utils/disappearingMessages.js';

/** Synthetic conversation scope for group-chat file storage (must be a valid ObjectId). */
const GROUP_ATTACHMENT_SCOPE = (workspaceId) => String(workspaceId);

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

async function assertWorkspaceMember(workspaceId, userId) {
  const membership = await WorkspaceMember.findOne({ workspaceId, userId }).select('_id').lean();
  if (!membership) {
    const error = new Error('Not a member of this workspace');
    error.statusCode = 403;
    throw error;
  }
  return membership;
}

async function getWorkspaceMemberUsers(workspaceId) {
  const members = await WorkspaceMember.find({ workspaceId }).select('userId').lean();
  if (!members.length) return [];

  const userIds = members.map((m) => m.userId);
  const users = await User.find({ _id: { $in: userIds } }).select('name profilePictureUrl').lean();
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  return members.map((m) => ({
    userId: m.userId,
    userName: usersById.get(String(m.userId))?.name || 'User',
    profilePictureUrl: usersById.get(String(m.userId))?.profilePictureUrl || null,
  }));
}

async function enrichMessagesWithSenderProfiles(messages) {
  if (!messages.length) return messages;

  const senderIds = [...new Set(messages.map((message) => String(message.senderUserId)))];
  const users = await User.find({ _id: { $in: senderIds } })
    .select('name profilePictureUrl')
    .lean();
  const usersById = new Map(users.map((user) => [String(user._id), user]));

  return messages.map((message) => {
    const sender = usersById.get(String(message.senderUserId));
    return {
      ...message,
      senderName: message.senderName || sender?.name || 'User',
      senderProfilePictureUrl:
        message.senderProfilePictureUrl || sender?.profilePictureUrl || null,
    };
  });
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

function serializeWorkspaceMessage(message) {
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
    workspaceId: String(message.workspaceId),
    senderUserId: String(message.senderUserId),
    replyTo,
    poll: serializePoll(message.poll),
    reactions: serializeReactions(message.reactions),
    expiresAt: message.expiresAt ? new Date(message.expiresAt).toISOString() : null,
  };
}

async function resolveGroupReplyTo(workspaceId, replyToMessageId) {
  if (!replyToMessageId) return null;
  if (!mongoose.Types.ObjectId.isValid(String(replyToMessageId))) {
    return null;
  }

  const source = await WorkspaceMessage.findOne({
    _id: replyToMessageId,
    workspaceId,
  }).lean();

  if (!source) return null;
  return buildReplyToSnapshot(source);
}

async function buildDeliveredTo(workspaceId, senderUserId, deliveredAt = new Date()) {
  const memberUsers = await getWorkspaceMemberUsers(workspaceId);
  return memberUsers
    .filter((member) => String(member.userId) !== String(senderUserId))
    .map((member) => ({
      userId: member.userId,
      userName: member.userName,
      deliveredAt,
    }));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveMentionsFromBody(body, members, senderUserId) {
  const mentionAll = /@all\b/i.test(body);
  const mentions = [];
  const seen = new Set();

  const sorted = [...members].sort(
    (a, b) => String(b.userName || '').length - String(a.userName || '').length,
  );

  for (const member of sorted) {
    const userName = String(member.userName || '').trim();
    if (!userName) continue;
    const pattern = new RegExp(`@${escapeRegExp(userName)}(?=\\s|$|[.,!?])`, 'i');
    if (!pattern.test(body)) continue;
    const userId = String(member.userId);
    if (seen.has(userId)) continue;
    seen.add(userId);
    mentions.push({
      userId: member.userId,
      userName,
    });
  }

  return { mentionAll, mentions };
}

function enrichMessagesDelivery(messages, memberUsers) {
  return messages.map((message) => {
    if (message.deliveredTo?.length) return message;
    const deliveredAt = message.createdAt || new Date();
    return {
      ...message,
      deliveredTo: memberUsers
        .filter((member) => String(member.userId) !== String(message.senderUserId))
        .map((member) => ({
          userId: member.userId,
          userName: member.userName,
          deliveredAt,
        })),
    };
  });
}

export const getWorkspaceMessages = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const before = req.query.before;

    const now = new Date();
    const query = {
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

    const [, messages] = await Promise.all([
      assertWorkspaceMember(workspaceId, userId),
      WorkspaceMessage.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('workspaceId senderUserId senderName senderProfilePictureUrl body attachments poll reactions replyTo mentionAll mentions deliveredTo readBy editedAt deletedAt expiresAt createdAt')
        .lean(),
    ]);

    const chronological = messages.reverse();
    const enriched = await enrichMessagesWithSenderProfiles(chronological);
    const needsEnrich = enriched.some((message) => !message.deliveredTo?.length);
    if (!needsEnrich) {
      res.json({ data: enriched.map((row) => serializeWorkspaceMessage(row)) });
      return;
    }

    const memberUsers = await getWorkspaceMemberUsers(workspaceId);
    res.json({
      data: enrichMessagesDelivery(enriched, memberUsers).map((row) =>
        serializeWorkspaceMessage(row),
      ),
    });
  } catch (error) {
    console.error('Get workspace messages error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load messages' });
  }
};

export const sendWorkspaceMessage = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { body, replyToMessageId, replyTo: clientReplyTo, attachments: rawAttachments, poll: rawPoll } =
      req.body || {};

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

    const user = await User.findById(req.user._id).select('name profilePictureUrl');
    if (!user) {
      return res.status(401).json({ error: 'User not found. Please login again.' });
    }

    const [, deliveredTo, memberUsers, resolvedReplyTo] = await Promise.all([
      assertWorkspaceMember(workspaceId, user._id),
      buildDeliveredTo(workspaceId, user._id),
      getWorkspaceMemberUsers(workspaceId),
      resolveGroupReplyTo(workspaceId, replyToMessageId),
    ]);

    for (const attachment of attachments) {
      const expectedPrefix = `/api/files/chat-attachments/${workspaceId}/${GROUP_ATTACHMENT_SCOPE(workspaceId)}/`;
      if (!attachment.url.startsWith(expectedPrefix)) {
        return res.status(400).json({ error: 'Invalid attachment reference' });
      }
    }

    const replyTo = normalizeClientReplyTo(clientReplyTo) || resolvedReplyTo;
    const { mentionAll, mentions } = resolveMentionsFromBody(trimmedBody, memberUsers, user._id);
    const workspace = await Workspace.findById(workspaceId)
      .select('name')
      .lean();
    // Disappearing messages are DM-only (not workspace group chat).
    const expiresAt = null;

    const createData = {
      workspaceId,
      senderUserId: user._id,
      senderName: user.name || 'User',
      senderProfilePictureUrl: user.profilePictureUrl || null,
      body: trimmedBody,
      attachments,
      ...(poll ? { poll } : {}),
      mentionAll,
      mentions,
      deliveredTo,
      readBy: [],
      expiresAt,
    };
    if (replyTo?.messageId) {
      createData.replyTo = {
        messageId: replyTo.messageId,
        senderUserId: replyTo.senderUserId || null,
        senderName: replyTo.senderName || 'User',
        body: replyTo.body || '',
        deletedAt: replyTo.deletedAt || null,
      };
    }

    const created = await WorkspaceMessage.create(createData);
    const saved = (await WorkspaceMessage.findById(created._id).lean()) || created.toObject();

    const payload = serializeWorkspaceMessage(saved);
    if (!payload.replyTo?.messageId && replyTo?.messageId) {
      payload.replyTo = {
        messageId: String(replyTo.messageId),
        senderUserId: replyTo.senderUserId ? String(replyTo.senderUserId) : null,
        senderName: replyTo.senderName || 'User',
        body: replyTo.body || '',
        deletedAt: replyTo.deletedAt || null,
      };
    }
    await broadcastToWorkspace(workspaceId, 'workspace-chat:message', payload);

    void notifyWorkspaceChatPush({
      workspaceId,
      workspaceName: workspace?.name || 'Workspace',
      message: payload,
      senderUserId: user._id,
    }).catch((error) => {
      console.error('Workspace chat push notification error:', error);
    });

    void notifyWorkspaceGroupMessageRecipients({
      workspaceId,
      workspaceName: workspace?.name || 'Workspace',
      message: payload,
      memberUsers,
    }).catch((error) => {
      console.error('Workspace chat in-app notification error:', error);
    });

    res.status(201).json({ data: payload });
  } catch (error) {
    console.error('Send workspace message error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to send message' });
  }
};

export const voteWorkspaceMessagePoll = async (req, res) => {
  try {
    const { workspaceId, messageId } = req.params;
    const optionIndex = Number(req.body?.optionIndex);
    const userId = req.user._id;
    if (!mongoose.Types.ObjectId.isValid(workspaceId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid workspace or message id' });
    }
    await assertWorkspaceMember(workspaceId, userId);
    const message = await WorkspaceMessage.findOne({ _id: messageId, workspaceId });
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
    const payload = serializeWorkspaceMessage(message.toObject());
    await broadcastToWorkspace(workspaceId, 'workspace-chat:edit', payload);
    res.json({ data: payload });
  } catch (error) {
    console.error('Vote workspace poll error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to vote on poll' });
  }
};

export const toggleWorkspaceMessageReaction = async (req, res) => {
  try {
    const { workspaceId, messageId } = req.params;
    const userId = req.user._id;
    const emoji = normalizeReactionEmoji(req.body?.emoji);
    if (!mongoose.Types.ObjectId.isValid(workspaceId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid workspace or message id' });
    }
    if (!emoji) return res.status(400).json({ error: 'A valid emoji is required' });
    await assertWorkspaceMember(workspaceId, userId);
    const message = await WorkspaceMessage.findOne({ _id: messageId, workspaceId });
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
    const payload = serializeWorkspaceMessage(message.toObject());
    await broadcastToWorkspace(workspaceId, 'workspace-chat:reaction', payload);
    res.json({ data: payload });
  } catch (error) {
    console.error('Toggle workspace message reaction error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to react to message' });
  }
};

export const markWorkspaceMessagesRead = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { messageIds } = req.body;
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

    const readEntry = {
      userId: user._id,
      userName: user.name || 'User',
      readAt: new Date(),
    };

    const candidateMessages = await WorkspaceMessage.find({
      workspaceId,
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
      await WorkspaceMessage.updateMany(
        {
          workspaceId,
          _id: { $in: idsToUpdate },
          'readBy.userId': { $ne: user._id },
        },
        { $push: { readBy: readEntry } },
      );
    }

    const updated = idsToUpdate.length
      ? await WorkspaceMessage.find({ _id: { $in: idsToUpdate } }).lean()
      : [];

    if (updated.length) {
      await Promise.all(
        updated.map((message) =>
          broadcastToWorkspace(workspaceId, 'workspace-chat:read', message),
        ),
      );
    }

    res.json({ data: updated });
  } catch (error) {
    console.error('Mark workspace messages read error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to mark messages read' });
  }
};

export const editWorkspaceMessage = async (req, res) => {
  try {
    const { workspaceId, messageId } = req.params;
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
      return res.status(400).json({ error: 'Message is required' });
    }

    await assertWorkspaceMember(workspaceId, userId);

    const message = await WorkspaceMessage.findOne({ _id: messageId, workspaceId });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (String(message.senderUserId) !== String(userId)) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }
    if (message.deletedAt) {
      return res.status(400).json({ error: 'Deleted messages cannot be edited' });
    }

    const memberUsers = await getWorkspaceMemberUsers(workspaceId);
    const { mentionAll, mentions } = resolveMentionsFromBody(trimmedBody, memberUsers, userId);

    message.body = trimmedBody;
    message.mentionAll = mentionAll;
    message.mentions = mentions;
    message.editedAt = new Date();
    await message.save();

    const payload = message.toObject();
    await broadcastToWorkspace(workspaceId, 'workspace-chat:edit', payload);

    res.json({ data: message });
  } catch (error) {
    console.error('Edit workspace message error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to edit message' });
  }
};

export const deleteWorkspaceMessage = async (req, res) => {
  try {
    const { workspaceId, messageId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    await assertWorkspaceMember(workspaceId, userId);

    const message = await WorkspaceMessage.findOne({ _id: messageId, workspaceId });
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
    message.mentionAll = false;
    message.mentions = [];
    await message.save();

    const payload = message.toObject();
    await broadcastToWorkspace(workspaceId, 'workspace-chat:delete', payload);

    res.json({ data: message });
  } catch (error) {
    console.error('Delete workspace message error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to delete message' });
  }
};

export const uploadWorkspaceChatAttachment = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await assertWorkspaceMember(workspaceId, userId);

    const conversationScope = GROUP_ATTACHMENT_SCOPE(workspaceId);
    const { url } = await saveStoredFile({
      userId,
      kind: 'chat-attachment',
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      workspaceId,
      conversationId: conversationScope,
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
    console.error('Upload workspace chat attachment error:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to upload attachment',
    });
  }
};

export const getGroupChatSettings = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user._id;
    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }
    await assertWorkspaceMember(workspaceId, userId);
    const workspace = await Workspace.findById(workspaceId)
      .select('name profilePictureUrl groupDisappearingDurationSec')
      .lean();
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const members = await getWorkspaceMemberUsers(workspaceId);
    res.json({
      data: {
        workspaceId: String(workspaceId),
        name: workspace.name || 'Workspace',
        profilePictureUrl: workspace.profilePictureUrl || null,
        disappearingDurationSec: Number(workspace.groupDisappearingDurationSec) || 0,
        members: members.map((m) => ({
          userId: String(m.userId),
          name: m.userName,
          profilePictureUrl: m.profilePictureUrl,
        })),
      },
    });
  } catch (error) {
    console.error('Get group chat settings error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load group info' });
  }
};

export const updateGroupChatDisappearing = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user._id;
    const durationSec = Number(req.body?.disappearingDurationSec);
    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }
    if (!isAllowedDisappearingDuration(durationSec)) {
      return res.status(400).json({ error: 'Invalid disappearing duration' });
    }
    await assertWorkspaceMember(workspaceId, userId);
    await Workspace.updateOne(
      { _id: workspaceId },
      { groupDisappearingDurationSec: durationSec },
    );
    const payload = {
      workspaceId: String(workspaceId),
      disappearingDurationSec: durationSec,
      updatedByUserId: String(userId),
    };
    await broadcastToWorkspace(workspaceId, 'workspace-chat:settings', payload);
    res.json({ data: payload });
  } catch (error) {
    console.error('Update group disappearing error:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to update disappearing messages',
    });
  }
};

export async function purgeExpiredGroupMessages() {
  const now = new Date();
  const expired = await WorkspaceMessage.find({
    expiresAt: { $ne: null, $lte: now },
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
  })
    .limit(200)
    .lean();

  if (!expired.length) return 0;

  let purged = 0;
  for (const message of expired) {
    await WorkspaceMessage.updateOne(
      { _id: message._id },
      {
        deletedAt: now,
        body: '',
        attachments: [],
        poll: undefined,
        reactions: [],
        mentionAll: false,
        mentions: [],
      },
    );
    const payload = serializeWorkspaceMessage({
      ...message,
      deletedAt: now,
      body: '',
      attachments: [],
      poll: undefined,
      reactions: [],
      mentionAll: false,
      mentions: [],
    });
    await broadcastToWorkspace(String(message.workspaceId), 'workspace-chat:delete', payload);
    purged += 1;
  }
  return purged;
}
