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
  findTransactionEvents,
  generateIdempotencyKey,
  getPaymentPublicConfig,
  describePaypackFailure,
  getPaypackPendingCashinCount,
  isMockPaymentsEnabled,
  isPaypackConfigured,
  mapPaypackStatus,
  parseCashinResponse,
  resolveMoMoNetwork,
  validateRwandaMobileNumber,
  verifyWebhookSignature,
} from '../utils/paypack.js';
import {
  applySuccessfulPayment,
  serializePaymentPlan,
  resolveSubscriptionAmount,
  getTrialEndsAt,
  isOnTrial,
  cancelSubscriptionPlan,
} from '../utils/paymentPlanUtils.js';
import {
  buildPaymentSyncMeta,
  canClaimPaypackRef,
  expireStalePendingPayments,
  findRecentPendingPayment,
  getBlockedPaypackRefs,
  recordPaymentSyncIssue,
  STALE_PENDING_MS,
  touchPaymentSync,
} from '../utils/subscriptionPaymentSync.js';

const MOCK_PAYMENT_DELAY_MS = Number(process.env.SUBSCRIPTION_MOCK_DELAY_MS || 4000);
const FIND_FAILED_GRACE_MS = 3 * 60 * 1000;
const SUCCESS_MIN_AGE_MS = 15 * 1000;
const POLL_SYNC_MIN_AGE_MS = 90 * 1000;

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
    const ageMs = Date.now() - new Date(payment.createdAt).getTime();
    const deferEarlySuccess = source === 'find' && ageMs < SUCCESS_MIN_AGE_MS;
    if (deferEarlySuccess) {
      console.log(
        `[Subscription] Deferring early SUCCESS for ${payment.referenceId} (${source}, ${providerStatus})`,
      );
      touchPaymentSync(payment);
      await payment.save();
      return payment;
    }
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
    // Only defer find()-based failures — Paypack find 404s early. Processed events are authoritative.
    if (source === 'find' && ageMs < FIND_FAILED_GRACE_MS) {
      console.log(
        `[Subscription] Deferring FAILED for recent payment ${payment.referenceId} (${providerStatus}, ${source})`,
      );
      touchPaymentSync(payment);
      await payment.save();
      return payment;
    }

    const failureHint = describePaypackFailure({
      provider: resolveMoMoNetwork({ provider: payment.provider, msisdn: payment.msisdn }),
      client: payment.msisdn,
      amount: payment.amount,
      immediate: ageMs < 15 * 1000,
    });
    const alreadyFailed = payment.status === 'FAILED';
    if (!alreadyFailed) {
      console.log(
        `[Subscription] Payment ${payment.referenceId} marked FAILED via ${source}: ${providerStatus}`,
        {
          msisdn: payment.msisdn,
          amount: payment.amount,
          ageSec: Math.round(ageMs / 1000),
        },
      );
      await recordPaymentSyncIssue(payment, failureHint.code, failureHint.message);
    }
    payment.status = 'FAILED';
    payment.providerStatus = String(providerStatus || failureHint.short);
    payment.mtnStatus = payment.providerStatus;
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

/** Safe ref-only Paypack sync — used during frontend polling (find API often 404s). */
async function syncPaymentViaRefEvents(payment) {
  const queries = [
    { ref: payment.referenceId, client: payment.msisdn, kind: 'CASHIN' },
    { ref: payment.referenceId, kind: 'CASHIN' },
  ];
  const snapshots = [];

  for (const query of queries) {
    try {
      snapshots.push(await findTransactionEvents(query));
    } catch {
      // try next query shape
    }
  }

  if (!snapshots.length) return payment;

  const eventStatus = extractPaypackStatusFromEventSnapshots(snapshots, payment.referenceId);
  if (!eventStatus) return payment;

  const eventRef = eventStatus.ref || payment.referenceId;
  const claim = await canClaimPaypackRef(payment, eventRef);
  if (!claim.ok) {
    await recordPaymentSyncIssue(payment, claim.code, claim.message);
    return payment;
  }

  if (eventRef !== payment.referenceId) payment.referenceId = eventRef;
  payment.financialTransactionId = eventRef;
  return applyProviderStatus(payment, eventStatus.status, {
    source: 'events',
    definitive: eventStatus.fromProcessed,
  });
}

export async function syncPaymentStatus(payment, { mode = 'full', recoverFailed = false } = {}) {
  if (payment.status === 'SUCCESSFUL') return payment;
  if (payment.status === 'FAILED' && !recoverFailed) return payment;

  const ageMs = Date.now() - new Date(payment.createdAt).getTime();
  const skipHeavyReconcile = mode === 'poll' || ageMs < POLL_SYNC_MIN_AGE_MS;

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

    const mapped = mapPaypackStatus(tx.status);
    if (mapped === 'PENDING' && ageMs > 5000) {
      payment = await syncPaymentViaRefEvents(payment);
      if (payment.status !== 'PENDING') return payment;
    }
    if (mapped !== 'SUCCESSFUL' || tx.ref === payment.referenceId) {
      return applyProviderStatus(payment, tx.status, { source: 'find', definitive: true });
    }
    await recordPaymentSyncIssue(
      payment,
      'REF_MISMATCH',
      `Paypack ref ${tx.ref} does not match ${payment.referenceId}`,
    );
    await payment.save();
    return payment;
  } catch (findError) {
    payment = await syncPaymentViaRefEvents(payment);
    if (payment.status === 'SUCCESSFUL' || payment.status === 'FAILED') return payment;

    if (skipHeavyReconcile) {
      await payment.save();
      return payment;
    }

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
  await syncPaymentStatus(failed, { recoverFailed: true });
  if (failed.status === 'SUCCESSFUL') {
    console.log(`[Subscription] Recovered falsely failed payment ${failed.referenceId}`);
  }
}

/** Reconcile stuck PENDING payments — used by scheduler. */
export async function reconcileStuckSubscriptionPayments({ limit = 25 } = {}) {
  const minAge = new Date(Date.now() - 2 * 60 * 1000);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stuck = await SubscriptionPayment.find({
    status: 'PENDING',
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

/** Undo subscription activation when lastPaidAt was set without any successful MoMo payment. */
async function healInconsistentPaymentPlan(user) {
  const plan = user.paymentPlan || {};
  if (!plan.lastPaidAt) return user;

  const hasSuccessfulPayment = await SubscriptionPayment.exists({
    userId: user._id,
    status: 'SUCCESSFUL',
  });
  if (hasSuccessfulPayment) return user;

  const trialEndsAt = getTrialEndsAt(user);
  const fixedPlan = {
    ...plan,
    lastPaidAt: null,
    nextDueDate: trialEndsAt,
    status: isOnTrial(user) ? 'active' : 'past_due',
  };
  await User.updateOne({ _id: user._id }, { $set: { paymentPlan: fixedPlan } });
  console.log(`[Subscription] Healed inconsistent payment plan for user ${user._id}`);
  return User.findById(user._id);
}

function paymentResponseData(payment, extra = {}) {
  const obj = payment?.toObject ? payment.toObject() : payment;
  return {
    ...obj,
    sync: buildPaymentSyncMeta(obj),
    ...extra,
  };
}

export const getSubscriptionPaymentConfig = async (req, res) => {
  try {
    const paymentConfig = getPaymentPublicConfig();
    res.json({ data: paymentConfig });
  } catch (error) {
    console.error('Get subscription payment config error:', error);
    res.status(500).json({ error: error.message || 'Failed to load payment config' });
  }
};

export const getSubscriptionStatus = async (req, res) => {
  try {
    let user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user = (await healInconsistentPaymentPlan(user)) || user;

    const shouldSync = req.query.sync === '1' || req.query.sync === 'true';
    if (shouldSync) {
      await syncUserPendingPayments(user._id, { recoverFailed: true });
      await expireStalePendingPayments(user._id);
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

async function resolveBlockingPendingPayment(userId, { forceRetry = false } = {}) {
  let pending = await SubscriptionPayment.findOne({
    userId,
    status: 'PENDING',
    createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
  }).sort({ createdAt: -1 });

  if (!pending) return { pending: null, user: null };

  pending = await syncPaymentStatus(pending, { mode: 'full' });

  if (pending.status === 'SUCCESSFUL') {
    return { pending, user: await User.findById(userId) };
  }

  if (pending.status === 'FAILED') {
    return { pending: null, user: null };
  }

  const ageMs = Date.now() - new Date(pending.createdAt).getTime();

  if (ageMs >= STALE_PENDING_MS) {
    pending.status = 'FAILED';
    pending.providerStatus = 'expired';
    pending.mtnStatus = 'expired';
    await recordPaymentSyncIssue(
      pending,
      'PAYMENT_EXPIRED',
      'Payment prompt expired after waiting. You can start a new payment.',
    );
    await pending.save();
    return { pending: null, user: null };
  }

  if (forceRetry) {
    if (ageMs >= 2 * 60 * 1000) {
      pending.status = 'FAILED';
      pending.providerStatus = 'abandoned';
      pending.mtnStatus = 'abandoned';
      await recordPaymentSyncIssue(
        pending,
        'PAYMENT_ABANDONED',
        'Previous payment attempt expired. Starting a new MoMo prompt.',
      );
      await pending.save();
      return { pending: null, user: null };
    }
  }

  return { pending, user: null };
}

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

    await syncUserPendingPayments(user._id);
    await expireStalePendingPayments(user._id);

    const forceRetry = req.body?.forceRetry === true || req.body?.forceRetry === 'true';
    const { pending: recentPending, user: paidUser } = await resolveBlockingPendingPayment(
      user._id,
      { forceRetry },
    );

    if (paidUser) {
      const paymentConfig = getPaymentPublicConfig();
      return res.status(200).json({
        message: 'Payment already completed.',
        code: 'ALREADY_PAID',
        data: {
          referenceId: recentPending.referenceId,
          amount: recentPending.amount,
          currency: recentPending.currency,
          status: 'SUCCESSFUL',
          inProgress: false,
          plan: serializePaymentPlan(paidUser),
          payment: paymentConfig,
          mtn: paymentConfig,
        },
      });
    }

    if (recentPending) {
      const paymentConfig = getPaymentPublicConfig();
      return res.status(200).json({
        message: 'A payment is already in progress. Approve the prompt on your phone or tap Pay again to send a new prompt.',
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

    if (!mock) {
      const pendingMomos = await getPaypackPendingCashinCount(number);
      if (pendingMomos >= 5) {
        const hint = describePaypackFailure({
          provider: phoneCheck.network === 'airtel' ? 'airtel' : 'mtn',
          client: number,
          amount,
          pendingCount: pendingMomos,
        });
        return res.status(409).json({
          error: hint.message,
          code: hint.code,
          data: { pendingCount: pendingMomos, requiredBalance: hint.requiredBalance },
        });
      }
    }

    let referenceId = crypto.randomUUID();
    let providerStatus = 'pending';

    if (!mock) {
      let result;
      try {
        result = await cashin({ amount, number, idempotencyKey });
      } catch (cashinError) {
        console.error('[Subscription] Paypack cashin failed:', cashinError.message);
        const raw = String(cashinError.message || '').toLowerCase();
        const insufficient =
          raw.includes('insufficient') ||
          raw.includes('not enough') ||
          raw.includes('balance') ||
          raw.includes('low funds');
        const hint = describePaypackFailure({
          provider: phoneCheck.network === 'airtel' ? 'airtel' : 'mtn',
          client: number,
          amount,
          immediate: insufficient,
        });
        return res.status(502).json({
          error: insufficient ? hint.message : (
            `${hint.network} could not send the payment prompt to ${number}. ` +
            `If you do not see it on your phone, dial ${hint.dial} to check pending approvals, ` +
            `then try again. ${cashinError.message || ''}`.trim()
          ),
          code: insufficient ? 'INSUFFICIENT_BALANCE' : 'CASHIN_FAILED',
        });
      }

      const parsed = parseCashinResponse(result);
      if (!parsed.ref) {
        console.error('[Subscription] Paypack cashin missing ref:', result);
        return res.status(502).json({
          error:
            'The payment provider did not confirm the MoMo request. ' +
            'Please wait a minute and try again once.',
          code: 'CASHIN_NO_REF',
        });
      }

      referenceId = parsed.ref;
      providerStatus = parsed.status || 'pending';
      console.log('[Subscription] Paypack cashin started', {
        referenceId,
        amount,
        number,
        network: phoneCheck.network,
        providerStatus,
        userId: String(user._id),
        webhookMode: process.env.PAYPACK_WEBHOOK_MODE || 'production',
      });
    }

    const payment = await SubscriptionPayment.create({
      userId: user._id,
      referenceId,
      externalId,
      amount,
      currency: plan.currency || 'RWF',
      msisdn: number,
      provider: phoneCheck.network || 'mtn',
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

    payment = await syncPaymentStatus(payment, { mode: 'full' });
    let user = await User.findById(req.user._id);
    if (user) user = (await healInconsistentPaymentPlan(user)) || user;

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

export const cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const plan = user.paymentPlan || {};
    if (plan.cancelledAt) {
      return res.status(200).json({
        message: 'Subscription is already cancelled.',
        data: { plan: serializePaymentPlan(user) },
      });
    }

    await syncUserPendingPayments(user._id);
    await expireStalePendingPayments(user._id);

    const pending = await SubscriptionPayment.findOne({
      userId: user._id,
      status: 'PENDING',
    }).sort({ createdAt: -1 });

    if (pending) {
      pending.status = 'CANCELLED';
      pending.providerStatus = 'cancelled';
      pending.mtnStatus = 'cancelled';
      await recordPaymentSyncIssue(
        pending,
        'PAYMENT_CANCELLED',
        'Payment cancelled because the subscription plan was cancelled.',
      );
    }

    cancelSubscriptionPlan(user);
    await User.updateOne({ _id: user._id }, { $set: { paymentPlan: user.paymentPlan } });
    const updated = await User.findById(user._id);

    res.json({
      message: 'Subscription cancelled.',
      data: { plan: serializePaymentPlan(updated) },
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel subscription', code: 'CANCEL_FAILED' });
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
