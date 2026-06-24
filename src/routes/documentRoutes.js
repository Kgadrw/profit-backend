import express from 'express';
import {
  getDocuments,
  getDocument,
  createDocument,
  updateDocument,
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

router.get('/', getDocuments);
router.get('/:id', validateObjectId, getDocument);
router.post('/', createDocument);
router.put('/:id', validateObjectId, updateDocument);
router.delete('/:id', validateObjectId, deleteDocument);

export default router;
