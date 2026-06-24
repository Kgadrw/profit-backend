import express from 'express';
import {
  getVendors,
  getVendor,
  getVendorActivity,
  createVendor,
  updateVendor,
  deleteVendor,
} from '../controllers/vendorController.js';
import { apiLimiter } from '../middleware/security.js';
import { validateObjectId } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { resolveWorkspaceContext } from '../middleware/workspaceContext.js';

const router = express.Router();

router.use(authenticateUser);
router.use(resolveWorkspaceContext);
router.use(requirePlusAccess);
router.use(apiLimiter);

router.get('/', getVendors);
router.get('/:id/activity', validateObjectId, getVendorActivity);
router.get('/:id', validateObjectId, getVendor);
router.post('/', createVendor);
router.put('/:id', validateObjectId, updateVendor);
router.delete('/:id', validateObjectId, deleteVendor);

export default router;
