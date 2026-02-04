// Barber Authentication Routes
import express from 'express';
import { barberLogin, barberRegister, barberForgotPin, barberResetPin, getBarberCurrentUser, updateBarberUser, changeBarberPin } from '../controllers/barberAuthController.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { validateRegister, validateLogin } from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// Register a new barber (with rate limiting and validation)
router.post('/register', rateLimiters.auth, validateRegister, barberRegister);

// Barber Login (with strict rate limiting and validation)
router.post('/login', rateLimiters.auth, validateLogin, barberLogin);

// Forgot PIN - Send OTP (with rate limiting)
router.post('/forgot-pin', rateLimiters.otp, barberForgotPin);

// Reset PIN - Verify OTP and reset (with rate limiting)
router.post('/reset-pin', rateLimiters.otp, barberResetPin);

// Get current barber user (requires authentication)
router.get('/me', authenticateUser, getBarberCurrentUser);

// Update barber user information (requires authentication)
router.put('/update', authenticateUser, updateBarberUser);

// Change PIN (requires authentication)
router.put('/change-pin', authenticateUser, changeBarberPin);

export default router;
