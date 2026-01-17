// Admin Routes
import express from 'express';
import {
  getSystemStats,
  getAllUsers,
  getUserActivity,
  getApiStats,
  getSystemHealth,
  getUserUsage,
} from '../controllers/adminController.js';

const router = express.Router();

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

export default router;
