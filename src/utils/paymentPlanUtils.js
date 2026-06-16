import { getSubscriptionAmount, getTrialDays } from './platformSettings.js';

export const TRIAL_DAYS = 7;
export const SUBSCRIPTION_AMOUNT = Number(process.env.SUBSCRIPTION_AMOUNT || 10000);

const LEGACY_SUBSCRIPTION_AMOUNT = 5000;

export function resolveSubscriptionAmount(_plan = {}) {
  return getSubscriptionAmount();
}

export function getTrialEndsAt(user) {
  const plan = user.paymentPlan || {};
  if (plan.trialEndsAt) return new Date(plan.trialEndsAt);
  const start = plan.startDate ? new Date(plan.startDate) : new Date(user.createdAt || Date.now());
  const end = new Date(start);
  end.setDate(end.getDate() + getTrialDays());
  return end;
}

export function isOnTrial(user) {
  const plan = user.paymentPlan || {};
  if (plan.lastPaidAt) return false;
  return Date.now() < getTrialEndsAt(user).getTime();
}

export function getTrialDaysLeft(user) {
  if (!isOnTrial(user)) return 0;
  const ms = getTrialEndsAt(user).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function hasPaidPeriodRemaining(plan) {
  if (!plan.lastPaidAt || !plan.nextDueDate) return false;
  return new Date(plan.nextDueDate).getTime() > Date.now();
}

export function requiresPayment(user) {
  const plan = user.paymentPlan || {};
  if (plan.cancelledAt || plan.active === false || plan.status === 'paused') return false;
  if (isOnTrial(user)) return false;
  if (!plan.lastPaidAt) return true;
  if (plan.status === 'past_due') return true;
  const nextDue = plan.nextDueDate ? new Date(plan.nextDueDate) : null;
  if (!nextDue) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  nextDue.setHours(0, 0, 0, 0);
  return nextDue.getTime() <= today.getTime();
}

export function hasPlusAccess(user) {
  const plan = user.paymentPlan || {};
  if (plan.cancelledAt || plan.active === false || plan.status === 'paused') {
    return hasPaidPeriodRemaining(plan);
  }
  if (isOnTrial(user)) return true;
  if (!plan.lastPaidAt) return false;
  const nextDue = plan.nextDueDate ? new Date(plan.nextDueDate) : null;
  return Boolean(nextDue && nextDue.getTime() > Date.now());
}

export function serializePaymentPlan(user) {
  const plan = user.paymentPlan || {};
  const onTrial = isOnTrial(user);
  const trialEndsAt = getTrialEndsAt(user);

  return {
    planName: plan.planName || 'Plus',
    active: plan.active !== false && !plan.cancelledAt,
    amount: resolveSubscriptionAmount(plan),
    currency: plan.currency || 'RWF',
    intervalMonths: plan.intervalMonths ?? 1,
    startDate: plan.startDate || user.createdAt,
    trialEndsAt: trialEndsAt.toISOString(),
    trialDaysLeft: getTrialDaysLeft(user),
    isOnTrial: onTrial,
    requiresPayment: requiresPayment(user),
    hasPlus: hasPlusAccess(user),
    nextDueDate: plan.nextDueDate || null,
    lastPaidAt: plan.lastPaidAt || null,
    cancelledAt: plan.cancelledAt ? new Date(plan.cancelledAt).toISOString() : null,
    isCancelled: Boolean(plan.cancelledAt),
    status: plan.cancelledAt ? 'cancelled' : (onTrial ? 'trial' : (plan.status || 'active')),
  };
}

/** User-initiated cancellation. Paid users keep Plus until nextDueDate. */
export function cancelSubscriptionPlan(user) {
  const plan = user.paymentPlan || {};
  plan.cancelledAt = new Date();
  plan.status = 'paused';
  plan.active = false;
  plan.reminderStage = '';
  plan.lastReminderAt = null;

  if (isOnTrial(user) || !plan.lastPaidAt) {
    plan.trialEndsAt = new Date();
  }

  user.paymentPlan = plan;
  return plan;
}

/** Apply a successful subscription payment to a user's payment plan. */
export function applySuccessfulPayment(user, paidAt = new Date()) {
  const plan = user.paymentPlan || {};
  const intervalMonths = Math.max(1, Number(plan.intervalMonths || 1) || 1);
  plan.intervalMonths = intervalMonths;
  plan.amount = resolveSubscriptionAmount(plan);
  if (!plan.currency) plan.currency = 'RWF';
  if (!plan.planName) plan.planName = 'Plus';
  plan.active = true;
  plan.cancelledAt = null;

  plan.lastPaidAt = paidAt;
  plan.status = 'active';
  plan.reminderStage = '';
  plan.lastReminderAt = null;

  const startDate = plan.startDate ? new Date(plan.startDate) : (user.createdAt || new Date());
  plan.startDate = startDate;

  const next = new Date(paidAt);
  next.setMonth(next.getMonth() + intervalMonths);
  plan.nextDueDate = next;

  user.paymentPlan = plan;
  return plan;
}
