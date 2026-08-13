import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';
import WorkspaceMember from '../models/WorkspaceMember.js';

let configured = false;

function ensureConfigured() {
  if (configured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@trippo.rw',
    publicKey,
    privateKey,
  );
  configured = true;
  return true;
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function toWebPushSubscription(record) {
  return {
    endpoint: record.endpoint,
    keys: {
      p256dh: record.keys.p256dh,
      auth: record.keys.auth,
    },
  };
}

async function sendPushToSubscription(record, payload) {
  if (!ensureConfigured()) return false;

  try {
    await webpush.sendNotification(toWebPushSubscription(record), JSON.stringify(payload));
    return true;
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await PushSubscription.deleteOne({ endpoint: record.endpoint });
    } else {
      console.error('[Push] Failed to deliver notification:', error?.message || error);
    }
    return false;
  }
}

export async function sendPushToUser(userId, payload) {
  if (!userId || !ensureConfigured()) return;

  const subscriptions = await PushSubscription.find({ userId }).lean();
  if (!subscriptions.length) return;

  await Promise.all(subscriptions.map((record) => sendPushToSubscription(record, payload)));
}

function truncateBody(body, maxLength = 140) {
  const trimmed = String(body || '').trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function buildDirectMessagePreview(message) {
  const trimmedBody = String(message?.body || '').trim();
  if (trimmedBody) return truncateBody(trimmedBody);
  const first = message?.attachments?.[0];
  if (!first) return 'New message';
  if (first.mimeType?.startsWith('image/')) return '📷 Photo';
  return `📎 ${first.fileName}`;
}

/** Push a new workspace chat message to all members except the sender. */
export async function notifyWorkspaceChatPush({
  workspaceId,
  workspaceName,
  message,
  senderUserId,
}) {
  if (!workspaceId || !message || !ensureConfigured()) return;

  const members = await WorkspaceMember.find({ workspaceId }).select('userId').lean();
  const recipientIds = members
    .map((member) => String(member.userId))
    .filter((userId) => userId !== String(senderUserId));

  if (!recipientIds.length) return;

  const sender = message.senderName || 'Someone';
  const title = workspaceName ? `${sender} · ${workspaceName}` : sender;
  const replyPrefix = message.replyTo?.messageId
    ? `↩ ${message.replyTo.senderName || 'Message'}: ${truncateBody(message.replyTo.body || '', 60)}\n`
    : '';
  const payload = {
    title,
    body: `${replyPrefix}${truncateBody(message.body)}`,
    icon: message.senderProfilePictureUrl || '/chat.png',
    badge: '/chat.png',
    tag: `workspace-chat-${workspaceId}`,
    silent: false,
    requireInteraction: true,
    renotify: true,
    data: {
      action: 'open_workspace_chat',
      workspaceId: String(workspaceId),
      messageId: String(message._id),
      href: '/messages/group',
      tag: `workspace-chat-${workspaceId}`,
    },
  };

  await Promise.all(recipientIds.map((userId) => sendPushToUser(userId, payload)));
}

/** Push a direct message to a single recipient. */
export async function notifyDirectMessagePush({
  recipientUserId,
  workspaceId,
  message,
}) {
  if (!recipientUserId || !message || !ensureConfigured()) return;

  const sender = message.senderName || 'Someone';
  const replyPrefix = message.replyTo?.messageId
    ? `↩ ${message.replyTo.senderName || 'Message'}: ${truncateBody(message.replyTo.body || '', 60)}\n`
    : '';
  const conversationId = String(message.conversationId || '');
  const tag = conversationId ? `workspace-dm-${conversationId}` : `workspace-dm-user-${message.senderUserId}`;
  const otherUserId = String(message.senderUserId);
  const href = `/messages/${otherUserId}`;
  const payload = {
    title: sender,
    body: `${replyPrefix}${buildDirectMessagePreview(message)}`,
    icon: message.senderProfilePictureUrl || '/chat.png',
    badge: '/chat.png',
    tag,
    silent: false,
    requireInteraction: true,
    renotify: true,
    data: {
      action: 'open_direct_chat',
      workspaceId: String(workspaceId),
      conversationId,
      otherUserId,
      messageId: String(message._id),
      href,
      tag,
    },
  };

  await sendPushToUser(recipientUserId, payload);
}
