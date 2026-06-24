import BankDeposit from '../models/BankDeposit.js';
import Expense from '../models/Expense.js';
import Payroll from '../models/Payroll.js';
import { buildListQuery, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import {
  normalizeMoneyDate,
  computeBudgetPeriodBounds,
  getViewPeriodBounds,
  periodsOverlap,
  startOfDay,
  endOfDay,
} from '../utils/budgetPeriodUtils.js';

function resolveUserId(req) {
  const userId = req.user._id === 'admin' ? null : req.user._id;
  return userId || null;
}

const pickDepositFields = (body, includeReceipt = true) => {
  const depositDate = body.depositDate !== undefined ? normalizeMoneyDate(body.depositDate) : new Date();
  const budgetPeriod = body.budgetPeriod || 'monthly';
  const { periodStart, periodEnd } = computeBudgetPeriodBounds(
    depositDate,
    budgetPeriod,
    body.periodStart,
    body.periodEnd,
  );

  const fields = {
    title: body.title?.trim(),
    amount: Number(body.amount),
    depositDate,
    budgetPeriod,
    periodStart,
    periodEnd,
    bankAccountName: body.bankAccountName ? body.bankAccountName.trim() : undefined,
    bankAccountNumber: body.bankAccountNumber ? body.bankAccountNumber.trim() : undefined,
    referenceNumber: body.referenceNumber ? body.referenceNumber.trim() : undefined,
    note: body.note !== undefined ? (body.note ? body.note.trim() : undefined) : undefined,
  };

  if (includeReceipt) {
    if (body.receiptUrl !== undefined) fields.receiptUrl = body.receiptUrl || undefined;
    if (body.receiptFileName !== undefined) fields.receiptFileName = body.receiptFileName || undefined;
  }

  return fields;
};

export const getBankDeposits = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { startDate, endDate } = req.query;
    const query = buildListQuery(req);

    if (startDate || endDate) {
      query.depositDate = {};
      if (startDate) {
        query.depositDate.$gte = startOfDay(startDate);
      }
      if (endDate) {
        query.depositDate.$lte = endOfDay(endDate);
      }
    }

    const deposits = await BankDeposit.find(query).sort({ depositDate: -1, createdAt: -1 });
    res.json({ data: deposits });
  } catch (error) {
    console.error('Error fetching bank deposits:', error);
    handleScopeError(res, error);
  }
};

export const getBankDeposit = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access bank deposit data' });
    }

    const deposit = await BankDeposit.findOne({ _id: req.params.id, userId });
    if (!deposit) {
      return res.status(404).json({ error: 'Bank deposit not found' });
    }

    res.json({ data: deposit });
  } catch (error) {
    console.error('Error fetching bank deposit:', error);
    res.status(500).json({ error: 'Failed to fetch bank deposit' });
  }
};

export const createBankDeposit = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create bank deposits' });
    }

    const fields = pickDepositFields(req.body);
    if (!fields.title) {
      return res.status(400).json({ error: 'Deposit title is required' });
    }
    if (!Number.isFinite(fields.amount) || fields.amount < 0) {
      return res.status(400).json({ error: 'Valid deposit amount is required' });
    }

    const deposit = new BankDeposit({ ...fields, userId });
    await deposit.save();
    res.status(201).json({ data: deposit });
  } catch (error) {
    console.error('Error creating bank deposit:', error);
    res.status(500).json({ error: 'Failed to create bank deposit' });
  }
};

export const updateBankDeposit = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update bank deposits' });
    }

    const deposit = await BankDeposit.findOne({ _id: req.params.id, userId });
    if (!deposit) {
      return res.status(404).json({ error: 'Bank deposit not found' });
    }

    const fields = pickDepositFields(req.body, true);
    Object.assign(deposit, fields);
    await deposit.save();
    res.json({ data: deposit });
  } catch (error) {
    console.error('Error updating bank deposit:', error);
    res.status(500).json({ error: 'Failed to update bank deposit' });
  }
};

export const deleteBankDeposit = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete bank deposits' });
    }

    const deposit = await BankDeposit.findOneAndDelete({ _id: req.params.id, userId });
    if (!deposit) {
      return res.status(404).json({ error: 'Bank deposit not found' });
    }

    res.json({ data: { success: true } });
  } catch (error) {
    console.error('Error deleting bank deposit:', error);
    res.status(500).json({ error: 'Failed to delete bank deposit' });
  }
};

export const getBankDepositSummary = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access bank deposit summary' });
    }

    const viewPeriod = ['monthly', 'quarterly', 'yearly'].includes(req.query.viewPeriod)
      ? req.query.viewPeriod
      : 'monthly';

    const referenceDate = req.query.referenceDate
      ? normalizeMoneyDate(req.query.referenceDate)
      : new Date();

    const { periodStart, periodEnd } = getViewPeriodBounds(viewPeriod, referenceDate);

    const [deposits, expenses, payrolls] = await Promise.all([
      BankDeposit.find({ userId }).lean(),
      Expense.find({
        userId,
        date: { $gte: periodStart, $lte: periodEnd },
      }).lean(),
      Payroll.find({
        userId,
        status: 'paid',
        paymentDate: { $gte: periodStart, $lte: periodEnd },
      }).lean(),
    ]);

    const overlappingDeposits = deposits.filter((row) =>
      periodsOverlap(
        startOfDay(row.periodStart),
        endOfDay(row.periodEnd),
        periodStart,
        periodEnd,
      ),
    );

    const totalDeposited = overlappingDeposits.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const totalExpenses = expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const totalPayroll = payrolls.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const totalUsed = totalExpenses + totalPayroll;
    const availableBalance = totalDeposited - totalUsed;

    res.json({
      data: {
        viewPeriod,
        periodStart,
        periodEnd,
        totalDeposited,
        totalUsed,
        totalExpenses,
        totalPayroll,
        availableBalance,
        depositCount: overlappingDeposits.length,
      },
    });
  } catch (error) {
    console.error('Error fetching bank deposit summary:', error);
    res.status(500).json({ error: 'Failed to fetch bank deposit summary' });
  }
};
