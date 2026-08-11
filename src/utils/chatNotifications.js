import Notification from '../models/Notification.js';
import User from '../models/User.js';
import WorkspaceMessage from '../models/WorkspaceMessage.js';
import WorkspaceDirectMessage from '../models/WorkspaceDirectMessage.js';
import WorkspaceDirectConversation from '../models/WorkspaceDirectConversation.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import Workspace from '../models/Workspace.js';
import { emitToUser } from './websocket.js';
import { sendEmail } from './emailService.js';

function getFrontendBaseUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:8080';
}

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

function unreadEmailHtml({ recipientName, senderName, workspaceName, deepLink }) {
  const safeSender = String(senderName || 'a teammate');
  const safeWorkspace = String(workspaceName || 'your workspace');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px;color:#111;">
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">Hello${recipientName ? ` ${recipientName}` : ''},</p>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
      There is some unread message from <strong>${safeSender}</strong> in <strong>${safeWorkspace}</strong>.
    </p>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
      <a href="${deepLink}" style="color:#2563eb;">Open messages</a>
    </p>
    <p style="margin:24px 0 0 0;font-size:14px;line-height:1.5;color:#555;">— Trippo</p>
  </div>
</body>
</html>`;
}

async function sendUnreadReminderEmail({ user, senderName, workspaceName, deepLink }) {
  if (!user?.email) return false;
  const subject = `Unread message from ${senderName || 'a teammate'}`;
  const text = `There is some unread message from ${senderName || 'a teammate'} in ${workspaceName || 'your workspace'}. Open: ${deepLink}`;
  await sendEmail({
    to: user.email,
    subject,
    text,
    html: unreadEmailHtml({
      recipientName: user.name,
      senderName,
      workspaceName,
      deepLink,
    }),
  });
  return true;
}

/**
 * Email users who still have messages unread for 24+ hours.
 * One reminder per message per recipient (tracked on the message document).
 */
export async function checkUnreadMessageEmailReminders() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const baseUrl = getFrontendBaseUrl().replace(/\/$/, '');
  let sent = 0;

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
    const remindedNow = [];

    for (const user of users) {
      try {
        const ok = await sendUnreadReminderEmail({
          user,
          senderName: message.senderName,
          workspaceName: workspace?.name,
          deepLink,
        });
        if (ok) {
          remindedNow.push(user._id);
          sent += 1;
        }
      } catch (error) {
        console.error('Unread group message email failed:', error);
      }
    }

    if (remindedNow.length) {
      await WorkspaceMessage.updateOne(
        { _id: message._id },
        { $addToSet: { unreadEmailRemindedUserIds: { $each: remindedNow } } },
      );
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
    const remindedNow = [];

    for (const user of users) {
      try {
        const ok = await sendUnreadReminderEmail({
          user,
          senderName: message.senderName,
          workspaceName: workspace?.name,
          deepLink,
        });
        if (ok) {
          remindedNow.push(user._id);
          sent += 1;
        }
      } catch (error) {
        console.error('Unread DM email failed:', error);
      }
    }

    if (remindedNow.length) {
      await WorkspaceDirectMessage.updateOne(
        { _id: message._id },
        { $addToSet: { unreadEmailRemindedUserIds: { $each: remindedNow } } },
      );
    }
  }

  if (sent > 0) {
    console.log(`Unread message email reminders sent: ${sent}`);
  }
  return sent;
}
