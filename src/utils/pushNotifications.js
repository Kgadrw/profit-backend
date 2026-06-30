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
  const payload = {
    title,
    body: truncateBody(message.body),
    icon: message.senderProfilePictureUrl || '/chat.png',
    badge: '/chat.png',
    tag: `workspace-chat-${message._id}`,
    silent: false,
    data: {
      action: 'open_workspace_chat',
      workspaceId: String(workspaceId),
      messageId: String(message._id),
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
  const payload = {
    title: sender,
    body: buildDirectMessagePreview(message),
    icon: message.senderProfilePictureUrl || '/chat.png',
    badge: '/chat.png',
    tag: `workspace-dm-${message._id}`,
    silent: false,
    data: {
      action: 'open_direct_chat',
      workspaceId: String(workspaceId),
      conversationId: String(message.conversationId),
      otherUserId: String(message.senderUserId),
      messageId: String(message._id),
    },
  };

  await sendPushToUser(recipientUserId, payload);
}
