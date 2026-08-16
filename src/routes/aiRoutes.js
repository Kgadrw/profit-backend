import express from 'express';
import { getRwandaHolidays, postOverviewInsights } from '../controllers/aiController.js';
import { authenticateUser } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();

router.use(authenticateUser);
router.use(rateLimiters.aiText);

router.get('/rwanda-holidays', getRwandaHolidays);
router.post('/overview-insights', postOverviewInsights);

export default router;
