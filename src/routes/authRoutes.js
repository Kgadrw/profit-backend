// Authentication Routes
import express from 'express';
import {
  register,
  sendRegistrationOtp,
  login,
  getCurrentUser,
  updateUser,
  changePassword,
  deleteAccount,
  forgotPassword,
  resetPassword,
  checkEmail,
  verifyTicket,
  googleAuth,
} from '../controllers/authController.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import {
  validateRegister,
  validateLogin,
  validateSendRegistrationOtp,
  validateForgotPassword,
  validateResetPassword,
} from '../middleware/validation.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

router.post('/register/send-otp', rateLimiters.otp, validateSendRegistrationOtp, sendRegistrationOtp);
router.post('/register', rateLimiters.auth, validateRegister, register);
router.post('/login', rateLimiters.auth, validateLogin, login);
router.post('/google', rateLimiters.auth, googleAuth);
router.post('/check-email', rateLimiters.auth, checkEmail);

router.post('/forgot-password', rateLimiters.otp, validateForgotPassword, forgotPassword);
router.post('/reset-password', rateLimiters.otp, validateResetPassword, resetPassword);
// Legacy aliases
router.post('/forgot-pin', rateLimiters.otp, validateForgotPassword, forgotPassword);
router.post('/reset-pin', rateLimiters.otp, validateResetPassword, resetPassword);

router.get('/verify-ticket', rateLimiters.general, verifyTicket);

router.get('/me', authenticateUser, getCurrentUser);
router.put('/update', authenticateUser, updateUser);
router.put('/change-password', authenticateUser, changePassword);
router.put('/change-pin', authenticateUser, changePassword);
router.delete('/delete-account', authenticateUser, deleteAccount);

export default router;
