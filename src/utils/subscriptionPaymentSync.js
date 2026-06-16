import SubscriptionPayment from '../models/SubscriptionPayment.js';

const MAX_SYNC_ISSUES = 10;
const PENDING_PAYMENT_WINDOW_MS = 15 * 60 * 1000;
export const STALE_PENDING_MS = 10 * 60 * 1000;

export async function recordPaymentSyncIssue(payment, code, message) {
  if (!payment.syncIssues) payment.syncIssues = [];
  payment.syncIssues.push({
    code: String(code),
    message: String(message || ''),
    at: new Date(),
  });
  if (payment.syncIssues.length > MAX_SYNC_ISSUES) {
    payment.syncIssues = payment.syncIssues.slice(-MAX_SYNC_ISSUES);
  }
  payment.lastSyncAt = new Date();
  await payment.save();
}

export function touchPaymentSync(payment) {
  payment.lastSyncAt = new Date();
}

export function buildPaymentSyncMeta(payment) {
  const issues = Array.isArray(payment.syncIssues) ? payment.syncIssues.slice(-5) : [];
  const latest = issues.length ? issues[issues.length - 1] : null;
  return {
    lastAt: payment.lastSyncAt || null,
    issues,
    latestIssue: latest ? { code: latest.code, message: latest.message } : null,
  };
}

/** Refs already linked to another user's payment — must not be reused for reconcile. */
export async function getBlockedPaypackRefs(payment) {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const others = await SubscriptionPayment.find({
    msisdn: payment.msisdn,
    userId: { $ne: payment.userId },
    createdAt: { $gte: since },
    referenceId: { $ne: payment.referenceId },
  })
    .select('referenceId status')
    .lean();

  return new Set(others.map((row) => row.referenceId).filter(Boolean));
}

export async function canClaimPaypackRef(payment, ref) {
  if (!ref) return { ok: false, code: 'MISSING_REF', message: 'Paypack reference missing' };

  const owner = await SubscriptionPayment.findOne({ referenceId: ref });
  if (!owner) return { ok: true };

  if (String(owner._id) === String(payment._id)) return { ok: true };

  if (String(owner.userId) === String(payment.userId)) {
    return { ok: false, code: 'DUPLICATE_REF', message: 'Reference belongs to another payment attempt for this account' };
  }

  return {
    ok: false,
    code: 'REF_OWNED_BY_OTHER_USER',
    message: 'This MoMo transaction belongs to another Trippo account',
  };
}

export async function findRecentPendingPayment(userId) {
  return SubscriptionPayment.findOne({
    userId,
    status: 'PENDING',
    createdAt: { $gte: new Date(Date.now() - PENDING_PAYMENT_WINDOW_MS) },
  })
    .sort({ createdAt: -1 })
    .lean();
}

/** Mark old PENDING rows as FAILED so they no longer block new payment attempts. */
export async function expireStalePendingPayments(userId, maxAgeMs = STALE_PENDING_MS) {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await SubscriptionPayment.find({
    userId,
    status: 'PENDING',
    createdAt: { $lt: cutoff },
  });

  for (const payment of stale) {
    payment.status = 'FAILED';
    payment.providerStatus = 'expired';
    payment.mtnStatus = 'expired';
    await recordPaymentSyncIssue(
      payment,
      'PAYMENT_EXPIRED',
      'Payment prompt expired after waiting. You can start a new payment.',
    );
  }

  return stale.length;
}
