import mongoose from 'mongoose';
import WorkspaceMessage from '../models/WorkspaceMessage.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import Workspace from '../models/Workspace.js';
import User from '../models/User.js';
import { broadcastToWorkspace } from '../utils/workspaceRealtime.js';
import { notifyWorkspaceChatPush } from '../utils/pushNotifications.js';
import { notifyWorkspaceGroupMessageRecipients } from '../utils/chatNotifications.js';

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

    const query = { workspaceId };
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
        .select('workspaceId senderUserId senderName senderProfilePictureUrl body mentionAll mentions deliveredTo readBy editedAt deletedAt createdAt')
        .lean(),
    ]);

    const chronological = messages.reverse();
    const enriched = await enrichMessagesWithSenderProfiles(chronological);
    const needsEnrich = enriched.some((message) => !message.deliveredTo?.length);
    if (!needsEnrich) {
      res.json({ data: enriched });
      return;
    }

    const memberUsers = await getWorkspaceMemberUsers(workspaceId);
    res.json({ data: enrichMessagesDelivery(enriched, memberUsers) });
  } catch (error) {
    console.error('Get workspace messages error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load messages' });
  }
};

export const sendWorkspaceMessage = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { body } = req.body;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    const trimmedBody = String(body || '').trim();
    if (!trimmedBody) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const user = await User.findById(req.user._id).select('name profilePictureUrl');
    if (!user) {
      return res.status(401).json({ error: 'User not found. Please login again.' });
    }

    const [, deliveredTo, memberUsers] = await Promise.all([
      assertWorkspaceMember(workspaceId, user._id),
      buildDeliveredTo(workspaceId, user._id),
      getWorkspaceMemberUsers(workspaceId),
    ]);

    const { mentionAll, mentions } = resolveMentionsFromBody(trimmedBody, memberUsers, user._id);

    const message = await WorkspaceMessage.create({
      workspaceId,
      senderUserId: user._id,
      senderName: user.name || 'User',
      senderProfilePictureUrl: user.profilePictureUrl || null,
      body: trimmedBody,
      mentionAll,
      mentions,
      deliveredTo,
      readBy: [],
    });

    const payload = message.toObject();
    await broadcastToWorkspace(workspaceId, 'workspace-chat:message', payload);

    const workspace = await Workspace.findById(workspaceId).select('name').lean();
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

    res.status(201).json({ data: message });
  } catch (error) {
    console.error('Send workspace message error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to send message' });
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
