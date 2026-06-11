import { hasPlusAccess, serializePaymentPlan } from '../utils/paymentPlanUtils.js';

/** Block API usage when trial ended and subscription is unpaid. */
export const requirePlusAccess = (req, res, next) => {
  if (req.user?.isAdmin) return next();

  const user = req.user;
  if (!user || !hasPlusAccess(user)) {
    return res.status(402).json({
      error: 'Subscription required. Your trial has ended — pay to continue using Trippo.',
      code: 'SUBSCRIPTION_REQUIRED',
      plan: user ? serializePaymentPlan(user) : null,
    });
  }

  next();
};
