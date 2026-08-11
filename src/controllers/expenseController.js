import Expense from '../models/Expense.js';
import Vendor from '../models/Vendor.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import {
  buildSubmissionFields,
  getInitialApprovalStatus,
  isWorkspaceApprovalEnabled,
} from '../utils/approvalWorkflow.js';

const normalizeExpenseDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

// Get all expenses for current user (optionally filtered by date range)
export const getExpenses = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { startDate, endDate } = req.query;
    const query = buildListQuery(req);

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const start =
          typeof startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
            ? (() => {
                const [y, m, d] = startDate.split("-").map(Number);
                return new Date(y, m - 1, d, 0, 0, 0, 0);
              })()
            : new Date(startDate);
        if (!Number.isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          query.date.$gte = start;
        }
      }
      if (endDate) {
        const end =
          typeof endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
            ? (() => {
                const [y, m, d] = endDate.split("-").map(Number);
                return new Date(y, m - 1, d, 23, 59, 59, 999);
              })()
            : new Date(endDate);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          query.date.$lte = end;
        }
      }
    }

    const expenses = await Expense.find(query).sort({ date: -1, createdAt: -1 });
    res.json({ data: expenses });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    handleScopeError(res, error);
  }
};

// Get single expense
export const getExpense = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const expense = await Expense.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ data: expense });
  } catch (error) {
    console.error('Error fetching expense:', error);
    handleScopeError(res, error);
  }
};

// Create expense
export const createExpense = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create expenses' });
    }

    const { title, amount, category, date, note, paymentMethod, bankAccountName, bankAccountNumber, receiptUrl, receiptFileName, vendorId, accountId, creditedAccountId } = req.body;

    let vendorName;
    let resolvedVendorId;
    if (vendorId) {
      const vendor = await Vendor.findOne(buildListQuery(req, { _id: vendorId }));
      if (vendor) {
        resolvedVendorId = vendor._id;
        vendorName = vendor.name;
      }
    }

    const approvalStatus = getInitialApprovalStatus(req);

    const expense = new Expense({
      title: title?.trim(),
      amount: Number(amount),
      category: category ? category.trim() : 'general',
      date: normalizeExpenseDate(date),
      note: note ? note.trim() : undefined,
      vendorId: resolvedVendorId,
      vendorName,
      accountId: accountId || undefined,
      creditedAccountId: creditedAccountId || undefined,
      paymentMethod: paymentMethod || 'cash',
      bankAccountName: bankAccountName ? bankAccountName.trim() : undefined,
      bankAccountNumber: bankAccountNumber ? bankAccountNumber.trim() : undefined,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      approvalStatus,
      ...buildSubmissionFields(req, approvalStatus),
      ...buildCreateScope(req),
    });

    await expense.save();
    res.status(201).json({ data: expense });
  } catch (error) {
    console.error('Error creating expense:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create expense' });
  }
};

// Update expense
export const updateExpense = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update expenses' });
    }

    const { title, amount, category, date, note, paymentMethod, bankAccountName, bankAccountNumber, receiptUrl, receiptFileName, vendorId, accountId, creditedAccountId } = req.body;
    const expense = await Expense.findOne(buildListQuery(req, { _id: req.params.id }));

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (isWorkspaceApprovalEnabled(req) && expense.approvalStatus === 'pending_approval') {
      return res.status(400).json({ error: 'Pending expenses cannot be edited. Wait for approval or delete and recreate.' });
    }

    if (title !== undefined) expense.title = title?.trim();
    if (amount !== undefined) expense.amount = Number(amount);
    if (category !== undefined) expense.category = category ? category.trim() : 'general';
    if (date !== undefined) expense.date = normalizeExpenseDate(date);
    if (note !== undefined) expense.note = note ? note.trim() : undefined;
    if (vendorId !== undefined) {
      if (vendorId) {
        const vendor = await Vendor.findOne(buildListQuery(req, { _id: vendorId }));
        expense.vendorId = vendor ? vendor._id : undefined;
        expense.vendorName = vendor ? vendor.name : undefined;
      } else {
        expense.vendorId = undefined;
        expense.vendorName = undefined;
      }
    }
    if (accountId !== undefined) expense.accountId = accountId || undefined;
    if (creditedAccountId !== undefined) expense.creditedAccountId = creditedAccountId || undefined;
    if (paymentMethod !== undefined) expense.paymentMethod = paymentMethod || 'cash';
    if (bankAccountName !== undefined) expense.bankAccountName = bankAccountName ? bankAccountName.trim() : undefined;
    if (bankAccountNumber !== undefined) expense.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : undefined;
    if (receiptUrl !== undefined) expense.receiptUrl = receiptUrl || undefined;
    if (receiptFileName !== undefined) expense.receiptFileName = receiptFileName || undefined;

    if (isWorkspaceApprovalEnabled(req) && expense.approvalStatus === 'rejected') {
      expense.approvalStatus = 'pending_approval';
      Object.assign(expense, buildSubmissionFields(req, 'pending_approval'));
    }

    await expense.save();
    res.json({ data: expense });
  } catch (error) {
    console.error('Error updating expense:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update expense' });
  }
};

// Delete expense
export const deleteExpense = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete expenses' });
    }

    const expense = await Expense.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ message: 'Expense deleted successfully', data: expense });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
};

