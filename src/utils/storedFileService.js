import path from 'path';
import StoredFile from '../models/StoredFile.js';

const KIND_PATH_SEGMENT = {
  profile: 'profile',
  receipt: 'receipts',
  document: 'documents',
};

export function buildStoredFileUrl(userId, kind, filename) {
  const segment = KIND_PATH_SEGMENT[kind];
  return `/api/files/${segment}/${userId}/${filename}`;
}

export function parseStoredFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  const match = fileUrl.match(/\/files\/(receipts|documents|profile)\/([^/?#]+)\/([^/?#]+)/);
  if (!match) return null;

  const segment = match[1];
  const kind =
    segment === 'receipts' ? 'receipt' : segment === 'documents' ? 'document' : 'profile';

  return {
    kind,
    userId: match[2],
    filename: path.basename(match[3]),
  };
}

export function makeStoredFilename(originalName, prefix = '') {
  const ext = path.extname(originalName).toLowerCase();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
  return prefix ? `${prefix}${unique}` : unique;
}

export async function saveStoredFile({ userId, kind, buffer, originalName, mimeType }) {
  const filename =
    kind === 'profile'
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
  });

  return {
    stored,
    filename,
    url: buildStoredFileUrl(userId, kind, filename),
  };
}

export async function getStoredFile(userId, kind, filename) {
  const safeName = path.basename(filename);
  return StoredFile.findOne({ userId, kind, filename: safeName }).lean();
}

export async function deleteStoredFileByUrl(fileUrl) {
  const parsed = parseStoredFileUrl(fileUrl);
  if (!parsed) return;
  await StoredFile.deleteOne({
    userId: parsed.userId,
    kind: parsed.kind,
    filename: parsed.filename,
  });
}

export async function deleteStoredFilesForUser(userId, kind) {
  await StoredFile.deleteMany({ userId, kind });
}

export function sendStoredFile(res, stored) {
  res.set('Content-Type', stored.mimeType);
  res.set('Content-Length', String(stored.size));
  res.set('Content-Disposition', `inline; filename="${stored.originalName.replace(/"/g, '')}"`);
  res.send(stored.data);
}
