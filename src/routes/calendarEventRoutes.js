// Calendar Event Routes
import express from 'express';
import {
  getCalendarEvents,
  getCalendarEvent,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../controllers/calendarEventController.js';
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

router.get('/', getCalendarEvents);
router.get('/:id', validateObjectId, getCalendarEvent);
router.post('/', createCalendarEvent);
router.put('/:id', validateObjectId, updateCalendarEvent);
router.delete('/:id', validateObjectId, deleteCalendarEvent);

export default router;
