import path from 'path';
import mongoose from 'mongoose';
import StoredFile from '../models/StoredFile.js';
import { toNodeBuffer } from './documentCrypto.js';

/** MongoDB-backed file storage — bytes live in StoredFile.data (Buffer), not on disk. */

const KIND_PATH_SEGMENT = {
  profile: 'profile',
  'workspace-profile': 'workspace-profile',
  receipt: 'receipts',
  document: 'documents',
  'chat-attachment': 'chat-attachments',
};

export function buildStoredFileUrl(userId, kind, filename, scope = {}) {
  const segment = KIND_PATH_SEGMENT[kind];
  if (kind === 'chat-attachment' && scope.workspaceId && scope.conversationId) {
    return `/api/files/chat-attachments/${scope.workspaceId}/${scope.conversationId}/${filename}`;
  }
  return `/api/files/${segment}/${userId}/${filename}`;
}

export function parseStoredFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;

  const chatMatch = fileUrl.match(/\/files\/chat-attachments\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)/);
  if (chatMatch) {
    return {
      kind: 'chat-attachment',
      workspaceId: chatMatch[1],
      conversationId: chatMatch[2],
      filename: path.basename(chatMatch[3]),
    };
  }

  const match = fileUrl.match(
    /\/files\/(receipts|documents|profile|workspace-profile)\/([^/?#]+)\/([^/?#]+)/,
  );
  if (match) {
    const segment = match[1];
    const kind =
      segment === 'receipts'
        ? 'receipt'
        : segment === 'documents'
          ? 'document'
          : segment === 'workspace-profile'
            ? 'workspace-profile'
            : 'profile';

    return {
      kind,
      userId: match[2],
      filename: path.basename(match[3]),
    };
  }

  const legacyMatch = fileUrl.match(
    /\/uploads\/(profiles|receipts|documents)\/([^/?#]+)\/([^/?#]+)/,
  );
  if (!legacyMatch) return null;

  const folder = legacyMatch[1];
  const kind =
    folder === 'profiles' ? 'profile' : folder === 'receipts' ? 'receipt' : 'document';

  return {
    kind,
    userId: legacyMatch[2],
    filename: path.basename(legacyMatch[3]),
  };
}

export function makeStoredFilename(originalName, prefix = '') {
  const ext = path.extname(originalName).toLowerCase();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
  return prefix ? `${prefix}${unique}` : unique;
}

export async function saveStoredFile({
  userId,
  kind,
  buffer,
  originalName,
  mimeType,
  workspaceId = null,
  conversationId = null,
}) {
  const filename =
    kind === 'profile' || kind === 'workspace-profile'
      ? makeStoredFilename(originalName, 'avatar-')
      : makeStoredFilename(originalName);

  const stored = await StoredFile.create({
    userId,
    kind,
    filename,
    originalName,
    mimeType: mimeType || 'application/octet-stream',
    data: buffer,
    size: buffer.length,
    workspaceId: workspaceId || undefined,
    conversationId: conversationId || undefined,
  });

  const scope =
    kind === 'chat-attachment' && workspaceId && conversationId
      ? { workspaceId: String(workspaceId), conversationId: String(conversationId) }
      : {};

  return {
    stored,
    filename,
    url: buildStoredFileUrl(userId, kind, filename, scope),
  };
}

export async function getStoredFile(userId, kind, filename) {
  const safeName = path.basename(filename);
  return StoredFile.findOne({ userId, kind, filename: safeName }).lean();
}

export async function getStoredChatAttachment(workspaceId, conversationId, filename) {
  const safeName = path.basename(filename);
  const wsObjectId = mongoose.Types.ObjectId.isValid(String(workspaceId))
    ? new mongoose.Types.ObjectId(String(workspaceId))
    : workspaceId;
  const conversationObjectId = mongoose.Types.ObjectId.isValid(String(conversationId))
    ? new mongoose.Types.ObjectId(String(conversationId))
    : conversationId;

  return StoredFile.findOne({
    kind: 'chat-attachment',
    workspaceId: wsObjectId,
    conversationId: conversationObjectId,
    filename: safeName,
  }).lean();
}

export async function deleteStoredFileByUrl(fileUrl) {
  const parsed = parseStoredFileUrl(fileUrl);
  if (!parsed) return;
  if (parsed.kind === 'chat-attachment') {
    await StoredFile.deleteOne({
      kind: 'chat-attachment',
      workspaceId: parsed.workspaceId,
      conversationId: parsed.conversationId,
      filename: parsed.filename,
    });
    return;
  }
  await StoredFile.deleteOne({
    userId: parsed.userId,
    kind: parsed.kind,
    filename: parsed.filename,
  });
}

export async function deleteStoredFilesForOwner(ownerId, kind) {
  await StoredFile.deleteMany({ userId: ownerId, kind });
}

export function sendStoredFile(res, stored) {
  const data = toNodeBuffer(stored.data);
  res.set('Content-Type', stored.mimeType || 'application/octet-stream');
  res.set('Content-Length', String(data.length));
  res.set('Content-Disposition', `inline; filename="${String(stored.originalName || 'file').replace(/"/g, '')}"`);
  res.send(data);
}
