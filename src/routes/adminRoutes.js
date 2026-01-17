// Admin Routes
import express from 'express';
import {
  getSystemStats,
  getAllUsers,
  getUserActivity,
  getApiStats,
  getSystemHealth,
  getUserUsage,
  deleteUser,
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

// Delete user and all their data
router.delete('/users/:userId', deleteUser);

export default router;
