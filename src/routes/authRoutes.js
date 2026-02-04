// Authentication Routes
import express from 'express';
import { register, login, getCurrentUser, updateUser, changePin, deleteAccount, forgotPin, resetPin, checkEmail } from '../controllers/authController.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { validateRegister, validateLogin } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// Register a new user (with rate limiting and validation)
router.post('/register', rateLimiters.auth, validateRegister, register);

// Login (with strict rate limiting and validation)
router.post('/login', rateLimiters.auth, validateLogin, login);

// Check email to determine user role (for role detection)
router.post('/check-email', rateLimiters.auth, checkEmail);

// Forgot PIN - Send OTP (with rate limiting)
router.post('/forgot-pin', rateLimiters.otp, forgotPin);

// Reset PIN - Verify OTP and reset (with rate limiting)
router.post('/reset-pin', rateLimiters.otp, resetPin);

// Get current user (requires authentication)
router.get('/me', authenticateUser, getCurrentUser);

// Update user information (requires authentication)
router.put('/update', authenticateUser, updateUser);

// Change PIN (requires authentication)
router.put('/change-pin', authenticateUser, changePin);

// Delete account (requires authentication)
router.delete('/delete-account', authenticateUser, deleteAccount);

export default router;
