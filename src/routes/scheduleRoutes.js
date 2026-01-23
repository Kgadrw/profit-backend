// Schedule Routes
import express from 'express';
import {
  getSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  completeSchedule,
  getUpcomingSchedules,
} from '../controllers/scheduleController.js';
import { apiLimiter } from '../middleware/security.js';
import { validateObjectId } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// All schedule routes require authentication and rate limiting
router.use(authenticateUser);
router.use(apiLimiter);

router.get('/upcoming', getUpcomingSchedules);
router.get('/', getSchedules);
router.get('/:id', validateObjectId, getSchedule);
router.post('/', createSchedule);
router.put('/:id', validateObjectId, updateSchedule);
router.delete('/:id', validateObjectId, deleteSchedule);
router.put('/:id/complete', validateObjectId, completeSchedule);

export default router;
