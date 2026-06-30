import express from 'express';
import {
  getDocumentsSummary,
  getDocuments,
  getDocument,
  getDocumentProfile,
  getDocumentFile,
  createDocument,
  updateDocument,
  restoreDocumentVersion,
  addDocumentShare,
  removeDocumentShare,
  signDocument,
  verifyDocumentSignatures,
  deleteDocument,
} from '../controllers/documentController.js';
import { apiLimiter } from '../middleware/security.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { validateObjectId } from '../middleware/validation.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/summary', getDocumentsSummary);
router.get('/', getDocuments);
router.post('/', createDocument);
router.get('/:id/profile', validateObjectId, getDocumentProfile);
router.get('/:id/file', validateObjectId, getDocumentFile);
router.get('/:id/verify-signatures', validateObjectId, verifyDocumentSignatures);
router.get('/:id', validateObjectId, getDocument);
router.put('/:id', validateObjectId, updateDocument);
router.post('/:id/versions/:versionId/restore', validateObjectId, restoreDocumentVersion);
router.post('/:id/shares', validateObjectId, addDocumentShare);
router.delete('/:id/shares/:shareId', validateObjectId, removeDocumentShare);
router.post('/:id/sign', validateObjectId, signDocument);
router.delete('/:id', validateObjectId, deleteDocument);

export default router;
