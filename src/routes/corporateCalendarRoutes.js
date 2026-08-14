import express from 'express';
import {
  getCorporateCalendarSummary,
  getCorporateCalendarFeed,
  getCorporateCalendarReminders,
  getCompanyAnnouncements,
  createCompanyAnnouncement,
  updateCompanyAnnouncement,
  deleteCompanyAnnouncement,
} from '../controllers/corporateCalendarController.js';
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

router.get('/summary', getCorporateCalendarSummary);
router.get('/feed', getCorporateCalendarFeed);
router.get('/reminders', getCorporateCalendarReminders);
router.get('/announcements', getCompanyAnnouncements);
router.post('/announcements', createCompanyAnnouncement);
router.put('/announcements/:id', validateObjectId, updateCompanyAnnouncement);
router.delete('/announcements/:id', validateObjectId, deleteCompanyAnnouncement);

export default router;
