import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import WorkspaceMember from '../models/WorkspaceMember.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, '..', '..', 'uploads', 'receipts');
const documentsRoot = path.join(__dirname, '..', '..', 'uploads', 'documents');
const profilesRoot = path.join(__dirname, '..', '..', 'uploads', 'profiles');

fs.mkdirSync(uploadsRoot, { recursive: true });
fs.mkdirSync(documentsRoot, { recursive: true });
fs.mkdirSync(profilesRoot, { recursive: true });

function deleteStoredProfilePicture(userId, profilePictureUrl) {
  if (!profilePictureUrl) return;
  const match = profilePictureUrl.match(/\/files\/profile\/[^/]+\/([^/?#]+)/);
  if (!match) return;
  const safeName = path.basename(match[1]);
  const filePath = path.join(profilesRoot, String(userId), safeName);
  if (filePath.startsWith(path.join(profilesRoot, String(userId))) && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userId = String(req.user?._id || 'unknown');
    const userDir = path.join(uploadsRoot, userId);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, unique);
  },
});

const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']);

export const receiptUpload = multer({
  storage,
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

    const receiptUrl = `/api/files/receipts/${userId}/${req.file.filename}`;
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

    const safeName = path.basename(filename);
    const filePath = path.join(uploadsRoot, String(userId), safeName);

    if (!filePath.startsWith(path.join(uploadsRoot, String(userId)))) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving receipt file:', error);
    res.status(500).json({ error: 'Failed to load file' });
  }
};

const documentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userId = String(req.user?._id || 'unknown');
    const userDir = path.join(documentsRoot, userId);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, unique);
  },
});

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
  storage: documentStorage,
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

    const fileUrl = `/api/files/documents/${userId}/${req.file.filename}`;
    res.status(201).json({
      data: {
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
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

    const safeName = path.basename(filename);
    const filePath = path.join(documentsRoot, String(userId), safeName);

    if (!filePath.startsWith(path.join(documentsRoot, String(userId)))) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving company document:', error);
    res.status(500).json({ error: 'Failed to load file' });
  }
};

const profileStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userId = String(req.user?._id || 'unknown');
    const userDir = path.join(profilesRoot, userId);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, unique);
  },
});

const profileImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export const profileUpload = multer({
  storage: profileStorage,
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

    deleteStoredProfilePicture(userId, user.profilePictureUrl);

    const profilePictureUrl = `/api/files/profile/${userId}/${req.file.filename}`;
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

    deleteStoredProfilePicture(userId, user.profilePictureUrl);
    user.profilePictureUrl = undefined;
    await user.save();

    res.json({
      message: 'Profile picture removed',
      user: user.toJSON(),
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

    const safeName = path.basename(filename);
    const filePath = path.join(profilesRoot, String(fileUserId), safeName);

    if (!filePath.startsWith(path.join(profilesRoot, String(fileUserId)))) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving profile picture:', error);
    res.status(500).json({ error: 'Failed to load profile picture' });
  }
};
