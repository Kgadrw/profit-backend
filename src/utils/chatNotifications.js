import Notification from '../models/Notification.js';
import User from '../models/User.js';
import WorkspaceMessage from '../models/WorkspaceMessage.js';
import WorkspaceDirectMessage from '../models/WorkspaceDirectMessage.js';
import WorkspaceDirectConversation from '../models/WorkspaceDirectConversation.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import Workspace from '../models/Workspace.js';
import { emitToUser } from './websocket.js';
import { sendEmail, getFrontendBaseUrl, renderEmailTemplate } from './emailService.js';

function previewText(body, max = 120) {
  const text = String(body || '').trim().replace(/\s+/g, ' ');
  if (!text) return 'New message';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Create or refresh an unread chat notification for a recipient.
 * Coalesces within 30 minutes per conversation/thread so the bell is not flooded.
 */
export async function notifyUserOfChatMessage({
  recipientUserId,
  senderUserId,
  senderName,
  body,
  workspaceId,
  workspaceName,
  conversationId = null,
  otherUserId = null,
  messageId,
}) {
  if (!recipientUserId || String(recipientUserId) === String(senderUserId)) return null;

  const route = conversationId && otherUserId
    ? `/messages/${otherUserId}`
    : '/messages/group';

  const title = conversationId ? 'New direct message' : 'New workspace message';
  const displaySender = senderName || 'Someone';
  const notificationBody = `${displaySender}: ${previewText(body)}`;
  const since = new Date(Date.now() - 30 * 60 * 1000);

  const match = {
    userId: recipientUserId,
    type: 'workspace_message',
    read: false,
    'data.workspaceId': String(workspaceId),
    createdAt: { $gte: since },
  };
  if (conversationId) {
    match['data.conversationId'] = String(conversationId);
  } else {
    match['data.kind'] = 'group';
  }

  let notification = await Notification.findOne(match).sort({ createdAt: -1 });

  const data = {
    kind: conversationId ? 'direct' : 'group',
    workspaceId: String(workspaceId),
    workspaceName: workspaceName || 'Workspace',
    conversationId: conversationId ? String(conversationId) : null,
    messageId: messageId ? String(messageId) : null,
    senderUserId: String(senderUserId),
    senderName: displaySender,
    route,
  };

  if (notification) {
    notification.title = title;
    notification.body = notificationBody;
    notification.data = data;
    await notification.save();
  } else {
    notification = await Notification.create({
      userId: recipientUserId,
      sentBy: String(senderUserId),
      type: 'workspace_message',
      title,
      body: notificationBody,
      icon: '/logo.png',
      data,
      read: false,
    });
  }

  emitToUser(String(recipientUserId), 'notification:created', notification.toObject());
  return notification;
}

export async function notifyWorkspaceGroupMessageRecipients({
  workspaceId,
  workspaceName,
  message,
  memberUsers,
}) {
  const senderUserId = message.senderUserId;
  const recipients = (memberUsers || []).filter(
    (member) => String(member.userId) !== String(senderUserId),
  );

  await Promise.all(
    recipients.map((member) =>
      notifyUserOfChatMessage({
        recipientUserId: member.userId,
        senderUserId,
        senderName: message.senderName,
        body: message.body,
        workspaceId,
        workspaceName,
        messageId: message._id,
      }).catch((error) => {
        console.error('Group chat notification error:', error);
      }),
    ),
  );
}

export async function notifyDirectMessageRecipient({
  workspaceId,
  workspaceName,
  message,
  recipientUserId,
  otherUserIdForRoute,
}) {
  return notifyUserOfChatMessage({
    recipientUserId,
    senderUserId: message.senderUserId,
    senderName: message.senderName,
    body: message.body || 'Sent an attachment',
    workspaceId,
    workspaceName,
    conversationId: message.conversationId,
    otherUserId: otherUserIdForRoute || message.senderUserId,
    messageId: message._id,
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unreadDigestHtml({ recipientName, items }) {
  const list = items
    .map((item) => {
      const safeSender = escapeHtml(item.senderName || 'a teammate');
      const safeWorkspace = escapeHtml(item.workspaceName || 'your workspace');
      const link = escapeHtml(item.deepLink);
      return `<li style="margin:0 0 12px;">From <strong>${safeSender}</strong> in <strong>${safeWorkspace}</strong><br>
        <a href="${link}" style="color:#0f3d5e;font-weight:700;text-decoration:underline;">Open message</a></li>`;
    })
    .join('');

  return renderEmailTemplate({
    eyebrow: 'MESSAGES',
    title: 'Unread messages',
    greeting: `Hello${recipientName ? ` ${escapeHtml(recipientName)}` : ''},`,
    paragraphs: [
      `You have ${items.length} unread message${items.length === 1 ? '' : 's'}:`,
      `<ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.6;color:#243044;">${list}</ul>`,
    ],
    closing: 'Stay connected,',
  });
}

async function sendUnreadDigestEmail({ user, items }) {
  if (!user?.email || !items.length) return false;
  const subject =
    items.length === 1
      ? `Unread message from ${items[0].senderName || 'a teammate'}`
      : `You have ${items.length} unread messages`;
  const text = [
    `Hello${user.name ? ` ${user.name}` : ''},`,
    '',
    `You have ${items.length} unread message${items.length === 1 ? '' : 's'}:`,
    ...items.map(
      (item, index) =>
        `${index + 1}. From ${item.senderName || 'a teammate'} in ${item.workspaceName || 'your workspace'} — ${item.deepLink}`,
    ),
  ].join('\n');

  await sendEmail({
    to: user.email,
    subject,
    text,
    html: unreadDigestHtml({ recipientName: user.name, items }),
  });
  return true;
}

function queueUnreadItem(digestByUser, user, item, messageId) {
  const key = String(user._id);
  const existing = digestByUser.get(key) || {
    user,
    items: [],
    messageMarks: [],
  };
  existing.items.push(item);
  existing.messageMarks.push({ messageId, userId: user._id });
  digestByUser.set(key, existing);
}

/**
 * Email users who still have messages unread for 24+ hours.
 * One digest email per recipient (tracks reminded users on each message).
 */
export async function checkUnreadMessageEmailReminders() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const baseUrl = getFrontendBaseUrl().replace(/\/$/, '');
  const digestByUser = new Map();
  const groupMarks = new Map();
  const dmMarks = new Map();

  const groupCandidates = await WorkspaceMessage.find({
    createdAt: { $lte: cutoff },
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
  })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  for (const message of groupCandidates) {
    const members = await WorkspaceMember.find({ workspaceId: message.workspaceId })
      .select('userId')
      .lean();
    const readIds = new Set((message.readBy || []).map((entry) => String(entry.userId)));
    const reminded = new Set(
      (message.unreadEmailRemindedUserIds || []).map((id) => String(id)),
    );
    const recipients = members
      .map((m) => String(m.userId))
      .filter(
        (id) =>
          id !== String(message.senderUserId) && !readIds.has(id) && !reminded.has(id),
      );

    if (!recipients.length) continue;

    const workspace = await Workspace.findById(message.workspaceId).select('name').lean();
    const users = await User.find({ _id: { $in: recipients } }).select('name email').lean();
    const deepLink = `${baseUrl}/messages/group`;

    for (const user of users) {
      queueUnreadItem(
        digestByUser,
        user,
        {
          senderName: message.senderName,
          workspaceName: workspace?.name,
          deepLink,
        },
        String(message._id),
      );
      const marks = groupMarks.get(String(message._id)) || [];
      marks.push(user._id);
      groupMarks.set(String(message._id), marks);
    }
  }

  const dmCandidates = await WorkspaceDirectMessage.find({
    createdAt: { $lte: cutoff },
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
  })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  for (const message of dmCandidates) {
    const conversation = await WorkspaceDirectConversation.findById(message.conversationId)
      .select('participantIds')
      .lean();
    if (!conversation) continue;

    const readIds = new Set((message.readBy || []).map((entry) => String(entry.userId)));
    const reminded = new Set(
      (message.unreadEmailRemindedUserIds || []).map((id) => String(id)),
    );
    const recipients = (conversation.participantIds || [])
      .map((id) => String(id))
      .filter(
        (id) =>
          id !== String(message.senderUserId) && !readIds.has(id) && !reminded.has(id),
      );

    if (!recipients.length) continue;

    const workspace = await Workspace.findById(message.workspaceId).select('name').lean();
    const users = await User.find({ _id: { $in: recipients } }).select('name email').lean();
    const deepLink = `${baseUrl}/messages/${message.senderUserId}`;

    for (const user of users) {
      queueUnreadItem(
        digestByUser,
        user,
        {
          senderName: message.senderName,
          workspaceName: workspace?.name,
          deepLink,
        },
        String(message._id),
      );
      const marks = dmMarks.get(String(message._id)) || [];
      marks.push(user._id);
      dmMarks.set(String(message._id), marks);
    }
  }

  let sent = 0;
  const successfullyReminded = new Set();

  for (const entry of digestByUser.values()) {
    try {
      const ok = await sendUnreadDigestEmail({
        user: entry.user,
        items: entry.items,
      });
      if (!ok) continue;
      sent += 1;
      for (const mark of entry.messageMarks) {
        successfullyReminded.add(`${mark.messageId}:${String(mark.userId)}`);
      }
    } catch (error) {
      console.error('Unread digest email failed:', error);
    }
  }

  for (const [messageId, userIds] of groupMarks.entries()) {
    const remindedNow = userIds.filter((id) =>
      successfullyReminded.has(`${messageId}:${String(id)}`),
    );
    if (!remindedNow.length) continue;
    await WorkspaceMessage.updateOne(
      { _id: messageId },
      { $addToSet: { unreadEmailRemindedUserIds: { $each: remindedNow } } },
    );
  }

  for (const [messageId, userIds] of dmMarks.entries()) {
    const remindedNow = userIds.filter((id) =>
      successfullyReminded.has(`${messageId}:${String(id)}`),
    );
    if (!remindedNow.length) continue;
    await WorkspaceDirectMessage.updateOne(
      { _id: messageId },
      { $addToSet: { unreadEmailRemindedUserIds: { $each: remindedNow } } },
    );
  }

  if (sent > 0) {
    console.log(`Unread message email digests sent: ${sent}`);
  }
  return sent;
}
