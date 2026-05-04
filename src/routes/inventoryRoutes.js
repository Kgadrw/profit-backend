// Inventory Routes
import express from 'express';
import {
  getInventories,
  getInventory,
  createInventory,
  updateInventory,
  deleteInventory,
} from '../controllers/inventoryController.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { validateInventory, validateObjectId } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateUser);
router.use(rateLimiters.general);

router.get('/', getInventories);
router.get('/:id', validateObjectId, getInventory);
router.post('/', validateInventory, createInventory);
router.put('/:id', validateObjectId, validateInventory, updateInventory);
router.delete('/:id', validateObjectId, deleteInventory);

export default router;

