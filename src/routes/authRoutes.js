// Authentication Routes
import express from 'express';
import { register, login, getCurrentUser, updateUser, changePin } from '../controllers/authController.js';
import { authLimiter } from '../middleware/security.js';
import { validateRegister, validateLogin } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// Register a new user (with rate limiting and validation)
router.post('/register', authLimiter, validateRegister, register);

// Login (with strict rate limiting and validation)
router.post('/login', authLimiter, validateLogin, login);

// Get current user (requires authentication)
router.get('/me', authenticateUser, getCurrentUser);

// Update user information (requires authentication)
router.put('/update', authenticateUser, updateUser);

// Change PIN (requires authentication)
router.put('/change-pin', authenticateUser, changePin);

export default router;
