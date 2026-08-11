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

export const WORKSPACE_DM_MESSAGE_EVENT = 'workspace-dm:message';
export const WORKSPACE_DM_READ_EVENT = 'workspace-dm:read';
export const WORKSPACE_DM_EDIT_EVENT = 'workspace-dm:edit';
export const WORKSPACE_DM_DELETE_EVENT = 'workspace-dm:delete';

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

async function getWorkspacePeers(workspaceId, currentUserId) {
  const members = await WorkspaceMember.find({ workspaceId }).select('userId').lean();
  const peerIds = members
    .map((member) => String(member.userId))
    .filter((userId) => userId !== String(currentUserId));

  if (!peerIds.length) return [];

  const users = await User.find({ _id: { $in: peerIds } })
    .select('name email profilePictureUrl')
    .lean();

  return users.map((user) => ({
    userId: String(user._id),
    name: user.name || 'User',
    email: user.email || '',
    profilePictureUrl: user.profilePictureUrl || null,
  }));
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

function normalizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return [];
  return rawAttachments
    .slice(0, 5)
    .map((item) => ({
      url: String(item?.url || '').trim(),
      fileName: String(item?.fileName || '').trim(),
      mimeType: String(item?.mimeType || 'application/octet-stream').trim(),
      size: Number(item?.size) || 0,
    }))
    .filter((item) => item.url && item.fileName);
}

function buildLastMessagePreview(body, attachments, deletedAt) {
  if (deletedAt) return 'Message deleted';
  const trimmedBody = String(body || '').trim();
  if (trimmedBody) return trimmedBody;
  if (!attachments?.length) return '';
  const first = attachments[0];
  if (first.mimeType?.startsWith('image/')) return '📷 Photo';
  return `📎 ${first.fileName}`;
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

  const preview = buildLastMessagePreview(last.body, last.attachments, last.deletedAt);
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
  return {
    ...message,
    conversationId: String(conversationId),
    workspaceId: String(workspaceId),
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
          otherUser: peer,
          lastMessageAt: conversation?.lastMessageAt || null,
          lastMessageBody: conversation?.lastMessageBody || null,
          lastSenderUserId: conversation?.lastSenderUserId
            ? String(conversation.lastSenderUserId)
            : null,
          unreadCount,
        };
      }),
    );

    threads.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.otherUser.name.localeCompare(b.otherUser.name);
    });

    res.json({ data: threads });
  } catch (error) {
    console.error('List direct chat threads error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load chats' });
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
      .select('name email profilePictureUrl')
      .lean();

    res.json({
      data: {
        conversationId: String(conversation._id),
        otherUser: {
          userId: String(otherUserId),
          name: otherUser?.name || 'User',
          email: otherUser?.email || '',
          profilePictureUrl: otherUser?.profilePictureUrl || null,
        },
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

    const query = { conversationId, workspaceId };
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

    res.json({ data: messages.reverse() });
  } catch (error) {
    console.error('Get direct chat messages error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load messages' });
  }
};

export const sendDirectChatMessage = async (req, res) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const { body, attachments: rawAttachments } = req.body || {};
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    const trimmedBody = String(body || '').trim();
    const attachments = normalizeAttachments(rawAttachments);

    if (!trimmedBody && !attachments.length) {
      return res.status(400).json({ error: 'Message or attachment is required' });
    }

    const user = await User.findById(userId).select('name profilePictureUrl');
    if (!user) {
      return res.status(401).json({ error: 'User not found. Please login again.' });
    }

    await assertWorkspaceMember(workspaceId, userId);
    const conversation = await assertConversationAccess(conversationId, workspaceId, userId);

    for (const attachment of attachments) {
      const expectedPrefix = `/api/files/chat-attachments/${workspaceId}/${conversationId}/`;
      if (!attachment.url.startsWith(expectedPrefix)) {
        return res.status(400).json({ error: 'Invalid attachment reference' });
      }
    }

    const message = await WorkspaceDirectMessage.create({
      conversationId,
      workspaceId,
      senderUserId: user._id,
      senderName: user.name || 'User',
      senderProfilePictureUrl: user.profilePictureUrl || null,
      body: trimmedBody,
      attachments,
      readBy: [],
    });

    const preview = buildLastMessagePreview(trimmedBody, attachments);
    const now = message.createdAt || new Date();
    await WorkspaceDirectConversation.updateOne(
      { _id: conversationId },
      {
        lastMessageAt: now,
        lastMessageBody: preview,
        lastSenderUserId: user._id,
      },
    );

    const payload = serializeDirectMessage(message.toObject(), conversationId, workspaceId);

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

    res.status(201).json({ data: message });
  } catch (error) {
    console.error('Send direct chat message error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to send message' });
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
