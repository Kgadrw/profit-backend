import mongoose from 'mongoose';
import SubscriptionPayment from '../models/SubscriptionPayment.js';
import User from '../models/User.js';
import {
  syncPaymentStatus,
  reconcileStuckSubscriptionPayments,
} from './subscriptionController.js';
import { buildPaymentSyncMeta } from '../utils/subscriptionPaymentSync.js';
import { serializePaymentPlan } from '../utils/paymentPlanUtils.js';

function serializeAdminPayment(payment, user) {
  const row = payment?.toObject ? payment.toObject() : payment;
  return {
    _id: row._id,
    referenceId: row.referenceId,
    userId: row.userId,
    user: user
      ? {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          businessName: user.businessName,
        }
      : null,
    amount: row.amount,
    currency: row.currency,
    msisdn: row.msisdn,
    status: row.status,
    provider: row.provider,
    providerStatus: row.providerStatus,
    financialTransactionId: row.financialTransactionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    paidAt: row.paidAt,
    lastSyncAt: row.lastSyncAt,
    syncIssues: row.syncIssues || [],
    sync: buildPaymentSyncMeta(row),
  };
}

export const getAdminSubscriptionPaymentStats = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [statusCounts, withIssues, recent24h, stuckCount] = await Promise.all([
      SubscriptionPayment.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      SubscriptionPayment.countDocuments({
        createdAt: { $gte: since },
        'syncIssues.0': { $exists: true },
      }),
      SubscriptionPayment.countDocuments({ createdAt: { $gte: last24h } }),
      SubscriptionPayment.countDocuments({
        status: { $in: ['PENDING', 'FAILED'] },
        createdAt: { $gte: since, $lte: new Date(Date.now() - 2 * 60 * 1000) },
      }),
    ]);

    const byStatus = { PENDING: 0, SUCCESSFUL: 0, FAILED: 0, other: 0 };
    let successfulAmount = 0;
    for (const row of statusCounts) {
      const key = row._id;
      if (key === 'PENDING' || key === 'SUCCESSFUL' || key === 'FAILED') {
        byStatus[key] = row.count;
        if (key === 'SUCCESSFUL') successfulAmount = row.amount;
      } else {
        byStatus.other += row.count;
      }
    }

    res.json({
      data: {
        days,
        pending: byStatus.PENDING,
        successful: byStatus.SUCCESSFUL,
        failed: byStatus.FAILED,
        other: byStatus.other,
        withIssues,
        recent24h,
        stuckCount,
        successfulAmount,
      },
    });
  } catch (error) {
    console.error('Admin subscription payment stats error:', error);
    res.status(500).json({ error: error.message || 'Failed to load payment stats' });
  }
};

export const listAdminSubscriptionPayments = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = Math.max(0, Number(req.query.skip) || 0);
    const status = String(req.query.status || 'all').toUpperCase();
    const hasIssues = req.query.hasIssues === '1' || req.query.hasIssues === 'true';
    const search = String(req.query.search || '').trim();

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filter = { createdAt: { $gte: since } };

    if (status !== 'ALL' && ['PENDING', 'SUCCESSFUL', 'FAILED'].includes(status)) {
      filter.status = status;
    }
    if (hasIssues) {
      filter['syncIssues.0'] = { $exists: true };
    }
    if (search) {
      const userMatches = await User.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
        ],
      })
        .select('_id')
        .lean();
      const userIds = userMatches.map((u) => u._id);
      filter.$or = [
        { referenceId: { $regex: search, $options: 'i' } },
        { msisdn: { $regex: search, $options: 'i' } },
        ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
      ];
    }

    const [payments, total] = await Promise.all([
      SubscriptionPayment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SubscriptionPayment.countDocuments(filter),
    ]);

    const userIds = [...new Set(payments.map((p) => String(p.userId)))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('name email phone businessName paymentPlan')
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    res.json({
      data: {
        payments: payments.map((p) => serializeAdminPayment(p, userMap.get(String(p.userId)))),
        total,
        limit,
        skip,
        days,
      },
    });
  } catch (error) {
    console.error('List admin subscription payments error:', error);
    res.status(500).json({ error: error.message || 'Failed to list payments' });
  }
};

export const getAdminSubscriptionPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ error: 'Invalid payment id' });
    }

    const payment = await SubscriptionPayment.findById(paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const user = await User.findById(payment.userId).select('name email phone businessName paymentPlan');
    const related = await SubscriptionPayment.find({
      userId: payment.userId,
      _id: { $ne: payment._id },
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({
      data: {
        payment: serializeAdminPayment(payment, user),
        userPlan: user ? serializePaymentPlan(user) : null,
        relatedPayments: related.map((p) => serializeAdminPayment(p, user)),
      },
    });
  } catch (error) {
    console.error('Get admin subscription payment error:', error);
    res.status(500).json({ error: error.message || 'Failed to load payment' });
  }
};

export const resyncAdminSubscriptionPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ error: 'Invalid payment id' });
    }

    let payment = await SubscriptionPayment.findById(paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const before = payment.status;
    payment = await syncPaymentStatus(payment);
    const user = await User.findById(payment.userId).select('name email phone businessName paymentPlan');

    res.json({
      message:
        payment.status !== before
          ? `Payment status updated: ${before} → ${payment.status}`
          : 'Payment re-synced (no status change)',
      data: {
        payment: serializeAdminPayment(payment, user),
        userPlan: user ? serializePaymentPlan(user) : null,
        previousStatus: before,
      },
    });
  } catch (error) {
    console.error('Resync admin subscription payment error:', error);
    res.status(500).json({ error: error.message || 'Failed to resync payment' });
  }
};

export const reconcileAdminSubscriptionPayments = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit) || 25));
    const result = await reconcileStuckSubscriptionPayments({ limit });
    res.json({
      message: `Checked ${result.checked} payment(s), ${result.updated} status change(s)`,
      data: result,
    });
  } catch (error) {
    console.error('Admin reconcile subscription payments error:', error);
    res.status(500).json({ error: error.message || 'Failed to reconcile payments' });
  }
};
