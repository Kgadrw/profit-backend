// Authentication Routes
import express from 'express';
import { register, login, getCurrentUser, updateUser, changePin } from '../controllers/authController.js';

const router = express.Router();

// Register a new user
router.post('/register', register);

// Login
router.post('/login', login);

// Get current user
router.get('/me', getCurrentUser);

// Update user information
router.put('/update', updateUser);

// Change PIN
router.put('/change-pin', changePin);

export default router;
