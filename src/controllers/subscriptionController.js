import crypto from 'crypto';
import User from '../models/User.js';
import SubscriptionPayment from '../models/SubscriptionPayment.js';
import {
  cashin,
  findTransaction,
  findTransactionEventsByClient,
  listProcessedCashins,
  fetchTransactionEventSnapshots,
  findMatchingSuccessfulTransaction,
  extractPaypackStatusFromEventSnapshots,
  generateIdempotencyKey,
  getPaymentPublicConfig,
  isMockPaymentsEnabled,
  isPaypackConfigured,
  mapPaypackStatus,
  validateRwandaMobileNumber,
  verifyWebhookSignature,
} from '../utils/paypack.js';
import {
  applySuccessfulPayment,
  serializePaymentPlan,
  resolveSubscriptionAmount,
} from '../utils/paymentPlanUtils.js';
import {
  buildPaymentSyncMeta,
  canClaimPaypackRef,
  findRecentPendingPayment,
  getBlockedPaypackRefs,
  recordPaymentSyncIssue,
  touchPaymentSync,
} from '../utils/subscriptionPaymentSync.js';

const MOCK_PAYMENT_DELAY_MS = Number(process.env.SUBSCRIPTION_MOCK_DELAY_MS || 4000);
const FIND_FAILED_GRACE_MS = 3 * 60 * 1000;

async function finalizeSuccessfulPayment(payment) {
  if (payment.status === 'SUCCESSFUL') return payment;

  const user = await User.findById(payment.userId);
  if (!user) {
    await recordPaymentSyncIssue(payment, 'USER_NOT_FOUND', 'Account not found when confirming payment');
    return payment;
  }

  const plan = applySuccessfulPayment(user, new Date());
  await User.updateOne({ _id: user._id }, { $set: { paymentPlan: plan } });

  payment.status = 'SUCCESSFUL';
  payment.paidAt = new Date();
  touchPaymentSync(payment);
  await payment.save();
  return payment;
}

async function applyProviderStatus(payment, providerStatus, { source = 'unknown', definitive = true } = {}) {
  const mapped = mapPaypackStatus(providerStatus);
  payment.providerStatus = String(providerStatus || '');
  payment.mtnStatus = payment.providerStatus;

  if (mapped === 'SUCCESSFUL') {
    return finalizeSuccessfulPayment(payment);
  }

  if (mapped === 'FAILED') {
    if (!definitive) {
      console.log(
        `[Subscription] Ignoring non-definitive failed signal for ${payment.referenceId} (${providerStatus})`,
      );
      return payment;
    }

    const ageMs = Date.now() - new Date(payment.createdAt).getTime();
    if ((source === 'events' || source === 'find') && ageMs < FIND_FAILED_GRACE_MS) {
      console.log(
        `[Subscription] Deferring FAILED for recent payment ${payment.referenceId} (${providerStatus}, ${source})`,
      );
      touchPaymentSync(payment);
      await payment.save();
      return payment;
    }

    if (source === 'events' && ageMs < 5 * 60 * 1000) {
      console.log(
        `[Subscription] Deferring FAILED for recent payment ${payment.referenceId} (${providerStatus})`,
      );
      return payment;
    }

    console.log(
      `[Subscription] Payment ${payment.referenceId} marked FAILED via ${source}: ${providerStatus}`,
    );
    payment.status = 'FAILED';
    touchPaymentSync(payment);
    await payment.save();
  } else {
    touchPaymentSync(payment);
    await payment.save();
  }

  return payment;
}

async function applyMatchedPaypackTransaction(payment, match, source) {
  const ref = match?.ref || payment.referenceId;
  const claim = await canClaimPaypackRef(payment, ref);

  if (!claim.ok) {
    await recordPaymentSyncIssue(payment, claim.code, claim.message);
    return payment;
  }

  if (claim.sameUserSuccess && payment.status !== 'SUCCESSFUL') {
    return finalizeSuccessfulPayment(payment);
  }

  if (ref && ref !== payment.referenceId) {
    payment.referenceId = ref;
  }
  payment.financialTransactionId = ref || payment.referenceId;
  return applyProviderStatus(payment, match.status, { source: `reconcile-${source}`, definitive: true });
}

async function reconcileWithPaypackList(payment, source) {
  const listFn = source === 'processed' ? listProcessedCashins : findTransactionEventsByClient;
  const list = await listFn(payment.msisdn);
  const blockedRefs = await getBlockedPaypackRefs(payment);
  const match = findMatchingSuccessfulTransaction(payment, list, { blockedRefs });
  if (!match) return payment;

  return applyMatchedPaypackTransaction(payment, match, source);
}

export async function syncPaymentStatus(payment) {
  if (payment.status === 'SUCCESSFUL') return payment;
  if (payment.status === 'FAILED') {
    const ageMs = Date.now() - new Date(payment.createdAt).getTime();
    if (ageMs > 48 * 60 * 60 * 1000) return payment;
  }

  touchPaymentSync(payment);

  if (isMockPaymentsEnabled()) {
    const age = Date.now() - new Date(payment.createdAt).getTime();
    if (age >= MOCK_PAYMENT_DELAY_MS) {
      payment.financialTransactionId = `MOCK-${payment.referenceId.slice(0, 8)}`;
      return applyProviderStatus(payment, 'successful');
    }
    await payment.save();
    return payment;
  }

  if (!isPaypackConfigured()) {
    await recordPaymentSyncIssue(payment, 'PAYPACK_NOT_CONFIGURED', 'Payment provider is not configured');
    return payment;
  }

  try {
    const tx = await findTransaction(payment.referenceId);
    payment.financialTransactionId = tx.ref || payment.referenceId;

    const claim = await canClaimPaypackRef(payment, payment.financialTransactionId);
    if (!claim.ok) {
      await recordPaymentSyncIssue(payment, claim.code, claim.message);
      return payment;
    }

    return applyProviderStatus(payment, tx.status, { source: 'find', definitive: true });
  } catch (findError) {
    console.warn('[Subscription] Paypack find failed, trying reconcile/events:', findError.message);

    for (const source of ['processed', 'client']) {
      try {
        payment = await reconcileWithPaypackList(payment, source);
        if (payment.status === 'SUCCESSFUL') return payment;
      } catch (reconcileError) {
        console.warn(`[Subscription] Paypack reconcile (${source}) failed:`, reconcileError.message);
        await recordPaymentSyncIssue(
          payment,
          'RECONCILE_ERROR',
          `${source}: ${reconcileError.message}`,
        );
      }
    }

    try {
      const snapshots = await fetchTransactionEventSnapshots(payment);
      const eventStatus = extractPaypackStatusFromEventSnapshots(snapshots, payment.referenceId);
      if (eventStatus) {
        const eventRef = eventStatus.ref || payment.referenceId;
        const claim = await canClaimPaypackRef(payment, eventRef);
        if (!claim.ok) {
          await recordPaymentSyncIssue(payment, claim.code, claim.message);
        } else {
          if (eventRef !== payment.referenceId) payment.referenceId = eventRef;
          payment.financialTransactionId = eventRef;
          payment = await applyProviderStatus(payment, eventStatus.status, {
            source: 'events',
            definitive: eventStatus.fromProcessed,
          });
          if (payment.status === 'SUCCESSFUL') return payment;

          if (payment.status === 'FAILED') {
            for (const source of ['processed', 'client']) {
              try {
                payment = await reconcileWithPaypackList(payment, source);
                if (payment.status === 'SUCCESSFUL') return payment;
              } catch {
                // try next
              }
            }
          }
        }
      }
    } catch (eventsError) {
      console.warn('[Subscription] Paypack events sync failed:', eventsError.message);
      await recordPaymentSyncIssue(payment, 'EVENTS_ERROR', eventsError.message);
    }
  }

  await payment.save();
  return payment;
}

async function syncUserPendingPayments(userId, { recoverFailed = false } = {}) {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const pending = await SubscriptionPayment.find({
    userId,
    status: 'PENDING',
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .limit(3);

  for (const doc of pending) {
    await syncPaymentStatus(doc);
  }

  if (!recoverFailed) return;

  const failed = await SubscriptionPayment.findOne({
    userId,
    status: 'FAILED',
    createdAt: { $gte: since },
  }).sort({ createdAt: -1 });

  if (!failed) return;

  failed.status = 'PENDING';
  failed.providerStatus = '';
  failed.mtnStatus = '';
  await failed.save();
  await syncPaymentStatus(failed);
  if (failed.status === 'SUCCESSFUL') {
    console.log(`[Subscription] Recovered falsely failed payment ${failed.referenceId}`);
  }
}

/** Reconcile stuck PENDING/FAILED payments — used by scheduler. */
export async function reconcileStuckSubscriptionPayments({ limit = 25 } = {}) {
  const minAge = new Date(Date.now() - 2 * 60 * 1000);
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const stuck = await SubscriptionPayment.find({
    status: { $in: ['PENDING', 'FAILED'] },
    createdAt: { $gte: since, $lte: minAge },
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  let updated = 0;
  for (const doc of stuck) {
    const before = doc.status;
    await syncPaymentStatus(doc);
    if (doc.status !== before) updated += 1;
  }

  if (stuck.length) {
    console.log(`[Subscription] Reconciled ${stuck.length} stuck payment(s), ${updated} status change(s)`);
  }
  return { checked: stuck.length, updated };
}

function paymentResponseData(payment, extra = {}) {
  const obj = payment?.toObject ? payment.toObject() : payment;
  return {
    ...obj,
    sync: buildPaymentSyncMeta(obj),
    ...extra,
  };
}

export const getSubscriptionStatus = async (req, res) => {
  try {
    let user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const shouldSync = req.query.sync === '1' || req.query.sync === 'true';
    if (shouldSync) {
      await syncUserPendingPayments(user._id, { recoverFailed: true });
      user = await User.findById(req.user._id);
    }

    const recentPayments = await SubscriptionPayment.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const pendingPayment = await findRecentPendingPayment(user._id);
    const paymentConfig = getPaymentPublicConfig();

    res.json({
      data: {
        plan: serializePaymentPlan(user),
        payment: paymentConfig,
        mtn: paymentConfig,
        recentPayments: recentPayments.map((p) => ({
          ...p,
          sync: buildPaymentSyncMeta(p),
        })),
        pendingPayment: pendingPayment
          ? {
              referenceId: pendingPayment.referenceId,
              status: pendingPayment.status,
              createdAt: pendingPayment.createdAt,
              msisdn: pendingPayment.msisdn,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ error: error.message || 'Failed to load subscription' });
  }
};

export const initiateSubscriptionPayment = async (req, res) => {
  try {
    const mock = isMockPaymentsEnabled();
    if (!isPaypackConfigured() && !mock) {
      return res.status(503).json({
        error: 'Paypack is not configured on the server. Add PAYPACK_CLIENT_ID and PAYPACK_CLIENT_SECRET to backend .env.',
        code: 'PAYPACK_NOT_CONFIGURED',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const recentPending = await SubscriptionPayment.findOne({
      userId: user._id,
      status: 'PENDING',
      createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
    }).sort({ createdAt: -1 });

    if (recentPending) {
      const paymentConfig = getPaymentPublicConfig();
      return res.status(200).json({
        message: 'A payment is already in progress. Approve the prompt on your phone or wait a few minutes.',
        code: 'PAYMENT_IN_PROGRESS',
        data: {
          referenceId: recentPending.referenceId,
          amount: recentPending.amount,
          currency: recentPending.currency,
          msisdn: recentPending.msisdn,
          status: recentPending.status,
          inProgress: true,
          payment: paymentConfig,
          mtn: paymentConfig,
        },
      });
    }

    const { phone, network } = req.body || {};
    const phoneCheck = validateRwandaMobileNumber(phone || user.phone);
    if (!phoneCheck.valid) {
      return res.status(400).json({ error: phoneCheck.error, code: 'INVALID_PHONE' });
    }

    if (network === 'mtn' && phoneCheck.network !== 'mtn') {
      return res.status(400).json({
        error: 'This number is not MTN. Choose Airtel or use an MTN number (078/079).',
        code: 'NETWORK_MISMATCH',
      });
    }
    if (network === 'airtel' && phoneCheck.network !== 'airtel') {
      return res.status(400).json({
        error: 'This number is not Airtel. Choose MTN or use an Airtel number (072/073).',
        code: 'NETWORK_MISMATCH',
      });
    }

    const number = phoneCheck.normalized;
    const plan = user.paymentPlan || {};
    const amount = resolveSubscriptionAmount(plan);
    const externalId = `trippo-sub-${user._id}-${Date.now()}`;
    const idempotencyKey = generateIdempotencyKey();

    let referenceId = crypto.randomUUID();
    let providerStatus = 'pending';

    if (!mock) {
      let result;
      try {
        result = await cashin({ amount, number, idempotencyKey });
      } catch (cashinError) {
        console.error('[Subscription] Paypack cashin failed:', cashinError.message);
        return res.status(502).json({
          error: cashinError.message || 'Could not start mobile money payment. Try again.',
          code: 'CASHIN_FAILED',
        });
      }

      referenceId = result?.ref || referenceId;
      providerStatus = result?.status || 'pending';
      console.log('[Subscription] Paypack cashin started', {
        referenceId,
        amount,
        number,
        providerStatus,
        userId: String(user._id),
        webhookMode: process.env.PAYPACK_WEBHOOK_MODE || 'development',
      });
    }

    const payment = await SubscriptionPayment.create({
      userId: user._id,
      referenceId,
      externalId,
      amount,
      currency: plan.currency || 'RWF',
      msisdn: number,
      provider: 'paypack',
      status: 'PENDING',
      providerStatus,
      mtnStatus: providerStatus,
      idempotencyKey,
    });

    const paymentConfig = getPaymentPublicConfig();
    res.status(201).json({
      message: mock
        ? 'Test payment started. It will complete automatically in a few seconds.'
        : 'Payment request sent. Approve the prompt on your phone.',
      data: {
        referenceId: payment.referenceId,
        amount: payment.amount,
        currency: payment.currency,
        msisdn: payment.msisdn,
        status: payment.status,
        inProgress: false,
        payment: paymentConfig,
        mtn: paymentConfig,
      },
    });
  } catch (error) {
    console.error('Initiate subscription payment error:', error);
    res.status(500).json({ error: error.message || 'Failed to initiate payment', code: 'INIT_FAILED' });
  }
};

export const getSubscriptionPaymentStatus = async (req, res) => {
  try {
    const { referenceId } = req.params;
    let payment = await SubscriptionPayment.findOne({
      referenceId,
      userId: req.user._id,
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found', code: 'NOT_FOUND' });

    payment = await syncPaymentStatus(payment);
    const user = await User.findById(req.user._id);

    res.json({
      data: {
        payment: paymentResponseData(payment),
        plan: user ? serializePaymentPlan(user) : null,
      },
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({ error: error.message || 'Failed to check payment status', code: 'SYNC_FAILED' });
  }
};

export const paypackWebhook = async (req, res) => {
  try {
    if (req.method === 'HEAD') {
      return res.sendStatus(200);
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
    const signature = req.get('X-Paypack-Signature') || req.get('x-paypack-signature');

    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn('[Paypack] Webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    if (payload.kind !== 'transaction:processed') {
      return res.status(200).json({ received: true });
    }

    const data = payload.data || {};
    const ref = data.ref;
    if (!ref) {
      return res.status(200).json({ received: true });
    }

    const payment = await SubscriptionPayment.findOne({ referenceId: ref });
    if (!payment) {
      console.warn(`[Paypack] Webhook for unknown ref ${ref}`);
      return res.status(200).json({ received: true });
    }

    const claim = await canClaimPaypackRef(payment, ref);
    if (!claim.ok) {
      await recordPaymentSyncIssue(payment, claim.code, claim.message);
      return res.status(200).json({ received: true });
    }

    payment.financialTransactionId = ref;
    await applyProviderStatus(payment, data.status, { source: 'webhook', definitive: true });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Paypack webhook error:', error);
    return res.status(200).json({ received: true });
  }
};

/** @deprecated MTN callback — kept for backwards compatibility */
export const mtnPaymentCallback = async (req, res) => {
  res.status(200).json({ received: true });
};
