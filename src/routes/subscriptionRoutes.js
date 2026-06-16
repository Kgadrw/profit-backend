import express from 'express';
import {
  getSubscriptionStatus,
  getSubscriptionPaymentConfig,
  initiateSubscriptionPayment,
  getSubscriptionPaymentStatus,
  cancelSubscription,
  mtnPaymentCallback,
} from '../controllers/subscriptionController.js';
import { authenticateUser } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/callback', rateLimiters.general, mtnPaymentCallback);

/** Public — no auth; only non-secret Paypack availability flags */
router.get('/payment-config', getSubscriptionPaymentConfig);

router.get('/status', authenticateUser, getSubscriptionStatus);
router.post('/cancel', authenticateUser, rateLimiters.general, cancelSubscription);
router.post('/pay', authenticateUser, rateLimiters.general, initiateSubscriptionPayment);
router.get('/payments/:referenceId', authenticateUser, getSubscriptionPaymentStatus);

export default router;
