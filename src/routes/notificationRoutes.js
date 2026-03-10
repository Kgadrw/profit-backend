// Notification Routes
import express from 'express';
import {
  getNotifications,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAll,
} from '../controllers/notificationController.js';
import { authenticateUser } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();

// All notification routes require authentication
router.use(authenticateUser);
router.use(rateLimiters.products); // Reuse products rate limiter

router.get('/', getNotifications);
router.post('/', createNotification);
router.put('/read-all', markAllAsRead);
router.put('/:id/read', markAsRead);
router.delete('/all', clearAll);
router.delete('/:id', deleteNotification);

export default router;
