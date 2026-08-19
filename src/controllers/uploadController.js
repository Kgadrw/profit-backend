import path from 'path';
import multer from 'multer';
import User from '../models/User.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import {
  saveStoredFile,
  getStoredFile,
  deleteStoredFileByUrl,
  deleteStoredFilesForOwner,
  sendStoredFile,
  getStoredChatAttachment,
} from '../utils/storedFileService.js';
import {
  destroyProfileImage,
  isCloudinaryUrl,
  uploadProfileImageBuffer,
} from '../utils/cloudinaryService.js';
import Workspace from '../models/Workspace.js';
import WorkspaceDirectConversation from '../models/WorkspaceDirectConversation.js';
import TeamReport from '../models/TeamReport.js';
import { parseStoredFileUrl } from '../utils/storedFileService.js';
import {
  buildFileResourceKey,
  createFileAccessToken,
  verifyFileAccessToken,
} from '../utils/fileAccessToken.js';

/** All uploads are buffered in memory and persisted in MongoDB (StoredFile collection). */
const memoryStorage = multer.memoryStorage();

const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']);

export const receiptUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk =
      file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    if (allowedExtensions.has(ext) && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDF files are allowed'));
    }
  },
});

export const uploadReceipt = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot upload receipts' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { url: receiptUrl } = await saveStoredFile({
      userId,
      kind: 'receipt',
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    res.status(201).json({
      data: {
        receiptUrl,
        receiptFileName: req.file.originalname,
      },
    });
  } catch (error) {
    console.error('Error uploading receipt:', error);
    res.status(500).json({ error: 'Failed to upload receipt' });
  }
};

export const getReceiptFile = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access files' });
    }

    const { userId: fileUserId, filename } = req.params;
    if (String(fileUserId) !== String(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stored = await getStoredFile(userId, 'receipt', filename);
    if (!stored) {
      return res.status(404).json({ error: 'File not found' });
    }

    return sendStoredFile(res, stored);
  } catch (error) {
    console.error('Error serving receipt file:', error);
    res.status(500).json({ error: 'Failed to load file' });
  }
};

const documentExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.csv',
]);

export const documentUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (documentExtensions.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

export const uploadCompanyDocument = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot upload documents' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { url: fileUrl, stored } = await saveStoredFile({
      userId,
      kind: 'document',
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    res.status(201).json({
      data: {
        fileUrl,
        fileName: req.file.originalname,
        fileSize: stored.size,
      },
    });
  } catch (error) {
    console.error('Error uploading company document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
};

export const getCompanyDocumentFile = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access files' });
    }

    const fileUserId = String(req.params.userId || '');
    const filename = decodeURIComponent(String(req.params.filename || ''));
    if (!fileUserId || !filename) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const allowed = await canAccessCompanyDocumentFile(userId, fileUserId, filename);
    if (!allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stored = await getStoredFile(fileUserId, 'document', filename);
    if (!stored) {
      return res.status(404).json({ error: 'File not found' });
    }

    return sendStoredFile(res, stored);
  } catch (error) {
    console.error('Error serving company document:', error);
    res.status(500).json({ error: 'Failed to load file' });
  }
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function canAccessCompanyDocumentFile(viewerUserId, fileUserId, filename) {
  if (String(viewerUserId) === String(fileUserId)) return true;

  const pathA = `/files/documents/${fileUserId}/${filename}`;
  const pathB = `/uploads/documents/${fileUserId}/${filename}`;
  const reports = await TeamReport.find({
    $or: [
      { attachmentUrl: new RegExp(escapeRegex(pathA), 'i') },
      { attachmentUrl: new RegExp(escapeRegex(pathB), 'i') },
    ],
  })
    .select('submitterUserId reportTo visibility workspaceId')
    .limit(20)
    .lean();

  if (!reports.length) return false;

  const workspaceIds = [
    ...new Set(reports.map((report) => report.workspaceId).filter(Boolean).map(String)),
  ];
  const memberships = workspaceIds.length
    ? await WorkspaceMember.find({
        userId: viewerUserId,
        workspaceId: { $in: workspaceIds },
      })
        .select('workspaceId role')
        .lean()
    : [];
  const membershipByWorkspace = new Map(
    memberships.map((member) => [String(member.workspaceId), member]),
  );

  return reports.some((report) => {
    if (String(report.submitterUserId) === String(viewerUserId)) return true;
    if ((report.reportTo || []).some((recipient) => recipient?.userId && String(recipient.userId) === String(viewerUserId))) {
      return true;
    }
    if (report.visibility !== 'public' || !report.workspaceId) return false;
    return membershipByWorkspace.has(String(report.workspaceId));
  });
}

const profileImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export const profileUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = file.mimetype.startsWith('image/');
    if (profileImageExtensions.has(ext) && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

export const uploadProfilePicture = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot upload a profile picture' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove previous Cloudinary + legacy Mongo/disk copies
    await destroyProfileImage({
      kind: 'profile',
      ownerId: userId,
      url: user.profilePictureUrl,
    });
    if (!isCloudinaryUrl(user.profilePictureUrl)) {
      await deleteStoredFileByUrl(user.profilePictureUrl);
    }
    await deleteStoredFilesForOwner(userId, 'profile');

    const uploaded = await uploadProfileImageBuffer({
      buffer: req.file.buffer,
      kind: 'profile',
      ownerId: userId,
      mimeType: req.file.mimetype,
    });

    // Cache-bust clients that may still hold an old CDN version
    const profilePictureUrl = uploaded.version
      ? `${uploaded.url}${uploaded.url.includes('?') ? '&' : '?'}v=${uploaded.version}`
      : uploaded.url;

    user.profilePictureUrl = profilePictureUrl;
    await user.save();

    res.status(201).json({
      message: 'Profile picture updated',
      data: { profilePictureUrl },
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to upload profile picture',
    });
  }
};

export const removeProfilePicture = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot remove a profile picture' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await destroyProfileImage({
      kind: 'profile',
      ownerId: userId,
      url: user.profilePictureUrl,
    });
    if (!isCloudinaryUrl(user.profilePictureUrl)) {
      await deleteStoredFileByUrl(user.profilePictureUrl);
    }
    await deleteStoredFilesForOwner(userId, 'profile');
    await User.findByIdAndUpdate(userId, { $unset: { profilePictureUrl: 1 } });
    user.profilePictureUrl = undefined;

    res.json({
      message: 'Profile picture removed',
      user: { ...user.toJSON(), profilePictureUrl: undefined },
    });
  } catch (error) {
    console.error('Error removing profile picture:', error);
    res.status(500).json({ error: 'Failed to remove profile picture' });
  }
};

export const getProfilePictureFile = async (req, res) => {
  try {
    const { userId: fileUserId, filename } = req.params;
    const safeFilename = path.basename(filename);
    const resourceKey = buildFileResourceKey('profile', [String(fileUserId), safeFilename]);

    let userId = null;
    if (req.fileAccessToken) {
      userId = verifyFileAccessToken(req.fileAccessToken, resourceKey);
      if (!userId || userId === 'admin') {
        return res.status(403).json({ error: 'Invalid or expired access token' });
      }
    } else {
      userId = req.user._id === 'admin' ? null : req.user._id;
      if (!userId) {
        return res.status(403).json({ error: 'Admin cannot access profile pictures' });
      }
    }

    if (String(fileUserId) !== String(userId)) {
      const viewerMemberships = await WorkspaceMember.find({ userId }).select('workspaceId').lean();
      const sharedWorkspaceIds = viewerMemberships.map((m) => m.workspaceId);
      const coMember = sharedWorkspaceIds.length
        ? await WorkspaceMember.findOne({
            userId: fileUserId,
            workspaceId: { $in: sharedWorkspaceIds },
          })
        : null;
      if (!coMember) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const stored = await getStoredFile(fileUserId, 'profile', safeFilename);
    if (!stored) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.set('Cache-Control', 'private, max-age=3600');
    return sendStoredFile(res, stored);
  } catch (error) {
    console.error('Error serving profile picture:', error);
    res.status(500).json({ error: 'Failed to load profile picture' });
  }
};

async function assertWorkspaceAdmin(workspaceId, userId) {
  const membership = await WorkspaceMember.findOne({ workspaceId, userId });
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    const error = new Error('Workspace admin access required');
    error.statusCode = 403;
    throw error;
  }
  return membership;
}

export const uploadWorkspaceProfilePicture = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot upload a workspace profile picture' });
    }

    const { workspaceId } = req.params;
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace id is required' });
    }

    await assertWorkspaceAdmin(workspaceId, userId);

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    await destroyProfileImage({
      kind: 'workspace-profile',
      ownerId: workspaceId,
      url: workspace.profilePictureUrl,
    });
    if (!isCloudinaryUrl(workspace.profilePictureUrl)) {
      await deleteStoredFileByUrl(workspace.profilePictureUrl);
    }
    await deleteStoredFilesForOwner(workspaceId, 'workspace-profile');

    const uploaded = await uploadProfileImageBuffer({
      buffer: req.file.buffer,
      kind: 'workspace-profile',
      ownerId: workspaceId,
      mimeType: req.file.mimetype,
    });

    const profilePictureUrl = uploaded.version
      ? `${uploaded.url}${uploaded.url.includes('?') ? '&' : '?'}v=${uploaded.version}`
      : uploaded.url;

    workspace.profilePictureUrl = profilePictureUrl;
    await workspace.save();

    res.status(201).json({
      message: 'Workspace profile picture updated',
      data: { profilePictureUrl },
      workspace: {
        id: workspace._id,
        name: workspace.name,
        profilePictureUrl: workspace.profilePictureUrl,
      },
    });
  } catch (error) {
    console.error('Error uploading workspace profile picture:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to upload workspace profile picture',
    });
  }
};

export const removeWorkspaceProfilePicture = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot remove a workspace profile picture' });
    }

    const { workspaceId } = req.params;
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace id is required' });
    }

    await assertWorkspaceAdmin(workspaceId, userId);

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    await destroyProfileImage({
      kind: 'workspace-profile',
      ownerId: workspaceId,
      url: workspace.profilePictureUrl,
    });
    if (!isCloudinaryUrl(workspace.profilePictureUrl)) {
      await deleteStoredFileByUrl(workspace.profilePictureUrl);
    }
    await deleteStoredFilesForOwner(workspaceId, 'workspace-profile');
    workspace.profilePictureUrl = undefined;
    await workspace.save();

    res.json({
      message: 'Workspace profile picture removed',
      workspace: {
        id: workspace._id,
        name: workspace.name,
        profilePictureUrl: null,
      },
    });
  } catch (error) {
    console.error('Error removing workspace profile picture:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to remove workspace profile picture',
    });
  }
};

export const getWorkspaceProfilePictureFile = async (req, res) => {
  try {
    const { workspaceId, filename } = req.params;
    const safeFilename = path.basename(filename);
    const resourceKey = buildFileResourceKey('workspace-profile', [
      String(workspaceId),
      safeFilename,
    ]);

    let userId = null;
    if (req.fileAccessToken) {
      userId = verifyFileAccessToken(req.fileAccessToken, resourceKey);
      if (!userId || userId === 'admin') {
        return res.status(403).json({ error: 'Invalid or expired access token' });
      }
    } else {
      userId = req.user._id === 'admin' ? null : req.user._id;
      if (!userId) {
        return res.status(403).json({ error: 'Admin cannot access workspace profile pictures' });
      }
    }

    const membership = await WorkspaceMember.findOne({ workspaceId, userId });
    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stored = await getStoredFile(workspaceId, 'workspace-profile', safeFilename);
    if (!stored) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.set('Cache-Control', 'private, max-age=3600');
    return sendStoredFile(res, stored);
  } catch (error) {
    console.error('Error serving workspace profile picture:', error);
    res.status(500).json({ error: 'Failed to load workspace profile picture' });
  }
};

const chatAttachmentExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.csv',
  '.webm',
  '.ogg',
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.mp4',
]);

export const chatAttachmentUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (chatAttachmentExtensions.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed. Use images, documents, or audio.'));
    }
  },
});

/**
 * Group chat attachments store files under conversationId === workspaceId.
 * Direct chat attachments use the real conversation ObjectId.
 */
async function assertChatAttachmentAccess(workspaceId, conversationId, userId) {
  const membership = await WorkspaceMember.findOne({ workspaceId, userId });
  if (!membership) return { ok: false, status: 403, error: 'Access denied' };

  // Workspace group-chat attachment scope (not a DM conversation id).
  if (String(conversationId) === String(workspaceId)) {
    return { ok: true };
  }

  const conversation = await WorkspaceDirectConversation.findOne({
    _id: conversationId,
    workspaceId,
  }).lean();
  if (!conversation) {
    return { ok: false, status: 404, error: 'Conversation not found' };
  }

  const isParticipant = (conversation.participantIds || []).some(
    (participantId) => String(participantId) === String(userId),
  );
  if (!isParticipant) {
    return { ok: false, status: 403, error: 'Access denied' };
  }

  return { ok: true };
}

export const getChatAttachmentFile = async (req, res) => {
  try {
    const { workspaceId, conversationId, filename } = req.params;
    const resourceKey = buildFileResourceKey('chat-attachment', [
      String(workspaceId),
      String(conversationId),
      path.basename(filename),
    ]);

    let userId = null;

    if (req.fileAccessToken) {
      userId = verifyFileAccessToken(req.fileAccessToken, resourceKey);
      if (!userId || userId === 'admin') {
        return res.status(403).json({ error: 'Invalid or expired access token' });
      }
    } else {
      userId = req.user._id === 'admin' ? null : req.user._id;
      if (!userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const access = await assertChatAttachmentAccess(workspaceId, conversationId, userId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const stored = await getStoredChatAttachment(workspaceId, conversationId, filename);
    if (!stored) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Allow in-app iframe/object preview from the web app origin.
    res.removeHeader('X-Frame-Options');
    res.set('Content-Security-Policy', "frame-ancestors *");
    res.set('Cache-Control', 'private, max-age=3600');
    return sendStoredFile(res, stored);
  } catch (error) {
    console.error('Error serving chat attachment:', error);
    res.status(500).json({ error: 'Failed to load attachment' });
  }
};

export const issueFileAccessToken = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    const parsed = parseStoredFileUrl(url.trim());
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid file url' });
    }

    if (parsed.kind === 'chat-attachment') {
      const { workspaceId, conversationId, filename } = parsed;
      const access = await assertChatAttachmentAccess(workspaceId, conversationId, userId);
      if (!access.ok) {
        return res.status(access.status).json({ error: access.error });
      }

      const resourceKey = buildFileResourceKey('chat-attachment', [
        String(workspaceId),
        String(conversationId),
        filename,
      ]);
      const issued = createFileAccessToken(userId, resourceKey);
      return res.json({ data: issued });
    }

    if (parsed.kind === 'profile') {
      if (String(parsed.userId) !== String(userId)) {
        const viewerMemberships = await WorkspaceMember.find({ userId }).select('workspaceId').lean();
        const sharedWorkspaceIds = viewerMemberships.map((m) => m.workspaceId);
        const coMember = sharedWorkspaceIds.length
          ? await WorkspaceMember.findOne({
              userId: parsed.userId,
              workspaceId: { $in: sharedWorkspaceIds },
            })
          : null;
        if (!coMember) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const resourceKey = buildFileResourceKey('profile', [String(parsed.userId), parsed.filename]);
      const issued = createFileAccessToken(userId, resourceKey);
      return res.json({ data: issued });
    }

    if (parsed.kind === 'workspace-profile') {
      const membership = await WorkspaceMember.findOne({ workspaceId: parsed.userId, userId });
      if (!membership) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const resourceKey = buildFileResourceKey('workspace-profile', [
        String(parsed.userId),
        parsed.filename,
      ]);
      const issued = createFileAccessToken(userId, resourceKey);
      return res.json({ data: issued });
    }

    return res.status(400).json({ error: 'Unsupported file type for access token' });
  } catch (error) {
    console.error('Error issuing file access token:', error);
    res.status(500).json({ error: 'Failed to issue access token' });
  }
};
