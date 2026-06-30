import express from 'express';
import {
  getAssets,
  getAsset,
  getAssetProfile,
  getAssetSummary,
  createAsset,
  updateAsset,
  deleteAsset,
  assignAssetCustody,
  addAssetMaintenance,
  completeAssetMaintenance,
  recordAssetAudit,
} from '../controllers/assetController.js';
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

router.get('/summary', getAssetSummary);
router.get('/', getAssets);
router.get('/:id/profile', validateObjectId, getAssetProfile);
router.get('/:id', validateObjectId, getAsset);
router.post('/', createAsset);
router.post('/:id/custody', validateObjectId, assignAssetCustody);
router.post('/:id/maintenance', validateObjectId, addAssetMaintenance);
router.post('/:id/maintenance/complete', validateObjectId, completeAssetMaintenance);
router.post('/:id/audit', validateObjectId, recordAssetAudit);
router.put('/:id', validateObjectId, updateAsset);
router.delete('/:id', validateObjectId, deleteAsset);

export default router;
