// Client Routes
import express from 'express';
import {
  getClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
} from '../controllers/clientController.js';
import { apiLimiter } from '../middleware/security.js';
import { validateObjectId } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// All client routes require authentication and rate limiting
router.use(authenticateUser);
router.use(apiLimiter);

router.get('/', getClients);
router.get('/:id', validateObjectId, getClient);
router.post('/', createClient);
router.put('/:id', validateObjectId, updateClient);
router.delete('/:id', validateObjectId, deleteClient);

export default router;
