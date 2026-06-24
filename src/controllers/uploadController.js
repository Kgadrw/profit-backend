import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import {
  saveStoredFile,
  getStoredFile,
  deleteStoredFileByUrl,
  deleteStoredFilesForUser,
  sendStoredFile,
} from '../utils/storedFileService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const legacyProfilesRoot = path.join(__dirname, '..', '..', 'uploads', 'profiles');
const legacyReceiptsRoot = path.join(__dirname, '..', '..', 'uploads', 'receipts');
const legacyDocumentsRoot = path.join(__dirname, '..', '..', 'uploads', 'documents');

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

function trySendLegacyFile(res, rootDir, userId, filename) {
  const safeName = path.basename(filename);
  const filePath = path.join(rootDir, String(userId), safeName);
  if (!filePath.startsWith(path.join(rootDir, String(userId)))) {
    return false;
  }
  if (!fs.existsSync(filePath)) {
    return false;
  }
  res.sendFile(filePath);
  return true;
}

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
    if (stored) {
      return sendStoredFile(res, stored);
    }

    if (trySendLegacyFile(res, legacyReceiptsRoot, userId, filename)) {
      return;
    }

    return res.status(404).json({ error: 'File not found' });
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

    const { userId: fileUserId, filename } = req.params;
    if (String(fileUserId) !== String(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stored = await getStoredFile(userId, 'document', filename);
    if (stored) {
      return sendStoredFile(res, stored);
    }

    if (trySendLegacyFile(res, legacyDocumentsRoot, userId, filename)) {
      return;
    }

    return res.status(404).json({ error: 'File not found' });
  } catch (error) {
    console.error('Error serving company document:', error);
    res.status(500).json({ error: 'Failed to load file' });
  }
};

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

    await deleteStoredFileByUrl(user.profilePictureUrl);
    await deleteStoredFilesForUser(userId, 'profile');

    const { url: profilePictureUrl } = await saveStoredFile({
      userId,
      kind: 'profile',
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    user.profilePictureUrl = profilePictureUrl;
    await user.save();

    res.status(201).json({
      message: 'Profile picture updated',
      data: { profilePictureUrl },
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({ error: error.message || 'Failed to upload profile picture' });
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

    await deleteStoredFileByUrl(user.profilePictureUrl);
    await deleteStoredFilesForUser(userId, 'profile');
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
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access profile pictures' });
    }

    const { userId: fileUserId, filename } = req.params;
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

    const stored = await getStoredFile(fileUserId, 'profile', filename);
    if (stored) {
      return sendStoredFile(res, stored);
    }

    if (trySendLegacyFile(res, legacyProfilesRoot, fileUserId, filename)) {
      return;
    }

    return res.status(404).json({ error: 'File not found' });
  } catch (error) {
    console.error('Error serving profile picture:', error);
    res.status(500).json({ error: 'Failed to load profile picture' });
  }
};
