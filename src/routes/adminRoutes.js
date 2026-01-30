// Admin Routes
import express from 'express';
import {
  getSystemStats,
  getAllUsers,
  getUserActivity,
  getApiStats,
  getSystemHealth,
  getUserUsage,
  getScheduleStats,
  deleteUser,
  testEmail,
  sendEmailToUser,
  sendBulkEmail,
} from '../controllers/adminController.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { validateObjectId } from '../middleware/validation.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = express.Router();

// All admin routes require admin authentication and strict rate limiting
router.use(authenticateAdmin);
router.use(rateLimiters.admin);

// Get system statistics
router.get('/stats', getSystemStats);

// Get all users
router.get('/users', getAllUsers);

// Get user activity
router.get('/activity', getUserActivity);

// Get user usage statistics
router.get('/usage', getUserUsage);

// Get API statistics
router.get('/api-stats', getApiStats);

// Get system health
router.get('/health', getSystemHealth);

// Get schedule statistics
router.get('/schedule-stats', getScheduleStats);

// Delete user and all their data
router.delete('/users/:userId', validateObjectId, deleteUser);

// Test email configuration
router.post('/test-email', testEmail);

// Send email to single user
router.post('/send-email', sendEmailToUser);

// Send bulk email to multiple users
router.post('/send-bulk-email', sendBulkEmail);

export default router;
