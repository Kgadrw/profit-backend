import Tax from '../models/Tax.js';
import Expense from '../models/Expense.js';
import { buildListQuery, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

const normalizeTaxDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

export const getTaxes = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { startDate, endDate, status } = req.query;
    const query = buildListQuery(req);

    if (status === 'pending' || status === 'paid') {
      query.status = status;
    }

    if (startDate || endDate) {
      query.dueDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.dueDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.dueDate.$lte = end;
      }
    }

    const taxes = await Tax.find(query).sort({ status: 1, dueDate: 1, createdAt: -1 });
    res.json({ data: taxes });
  } catch (error) {
    console.error('Error fetching taxes:', error);
    handleScopeError(res, error);
  }
};

export const getTax = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access tax data' });
    }

    const tax = await Tax.findOne({ _id: req.params.id, userId });
    if (!tax) {
      return res.status(404).json({ error: 'Tax not found' });
    }

    res.json({ data: tax });
  } catch (error) {
    console.error('Error fetching tax:', error);
    res.status(500).json({ error: 'Failed to fetch tax' });
  }
};

export const createTax = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create taxes' });
    }

    const {
      title,
      taxType,
      amount,
      dueDate,
      period,
      authority,
      referenceNumber,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
    } = req.body;

    const tax = new Tax({
      title: title?.trim(),
      taxType: taxType?.trim(),
      amount: Number(amount),
      dueDate: normalizeTaxDate(dueDate),
      period: period ? period.trim() : undefined,
      authority: authority ? authority.trim() : undefined,
      referenceNumber: referenceNumber ? referenceNumber.trim() : undefined,
      status: 'pending',
      note: note ? note.trim() : undefined,
      paymentMethod: paymentMethod || 'transfer',
      bankAccountName: bankAccountName ? bankAccountName.trim() : undefined,
      bankAccountNumber: bankAccountNumber ? bankAccountNumber.trim() : undefined,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      userId,
    });

    await tax.save();
    res.status(201).json({ data: tax });
  } catch (error) {
    console.error('Error creating tax:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create tax' });
  }
};

export const updateTax = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update taxes' });
    }

    const tax = await Tax.findOne({ _id: req.params.id, userId });
    if (!tax) {
      return res.status(404).json({ error: 'Tax not found' });
    }

    if (tax.status === 'paid') {
      return res.status(400).json({ error: 'Paid taxes cannot be edited' });
    }

    const {
      title,
      taxType,
      amount,
      dueDate,
      period,
      authority,
      referenceNumber,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
    } = req.body;

    if (title !== undefined) tax.title = title?.trim();
    if (taxType !== undefined) tax.taxType = taxType?.trim();
    if (amount !== undefined) tax.amount = Number(amount);
    if (dueDate !== undefined) tax.dueDate = normalizeTaxDate(dueDate);
    if (period !== undefined) tax.period = period ? period.trim() : undefined;
    if (authority !== undefined) tax.authority = authority ? authority.trim() : undefined;
    if (referenceNumber !== undefined) tax.referenceNumber = referenceNumber ? referenceNumber.trim() : undefined;
    if (note !== undefined) tax.note = note ? note.trim() : undefined;
    if (paymentMethod !== undefined) tax.paymentMethod = paymentMethod;
    if (bankAccountName !== undefined) tax.bankAccountName = bankAccountName ? bankAccountName.trim() : undefined;
    if (bankAccountNumber !== undefined) tax.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : undefined;
    if (receiptUrl !== undefined) tax.receiptUrl = receiptUrl || undefined;
    if (receiptFileName !== undefined) tax.receiptFileName = receiptFileName || undefined;

    await tax.save();
    res.json({ data: tax });
  } catch (error) {
    console.error('Error updating tax:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update tax' });
  }
};

export const markTaxPaid = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update taxes' });
    }

    const tax = await Tax.findOne({ _id: req.params.id, userId });
    if (!tax) {
      return res.status(404).json({ error: 'Tax not found' });
    }

    if (tax.status === 'paid') {
      return res.status(400).json({ error: 'Tax is already paid' });
    }

    const { paymentMethod, paymentDate, bankAccountName, bankAccountNumber, receiptUrl, receiptFileName, accountId } = req.body;

    const expenseNote = [
      tax.taxType ? `Type: ${tax.taxType}` : null,
      tax.authority ? `Authority: ${tax.authority}` : null,
      tax.referenceNumber ? `Ref: ${tax.referenceNumber}` : null,
      tax.note || null,
    ]
      .filter(Boolean)
      .join(' — ');

    const expense = new Expense({
      title: tax.title,
      amount: tax.amount,
      category: 'tax',
      date: normalizeTaxDate(paymentDate),
      note: expenseNote || 'Tax payment',
      paymentMethod: paymentMethod || tax.paymentMethod || 'transfer',
      bankAccountName: (bankAccountName || tax.bankAccountName)
        ? String(bankAccountName || tax.bankAccountName).trim()
        : undefined,
      bankAccountNumber: (bankAccountNumber || tax.bankAccountNumber)
        ? String(bankAccountNumber || tax.bankAccountNumber).trim()
        : undefined,
      receiptUrl: receiptUrl || tax.receiptUrl || undefined,
      receiptFileName: receiptFileName || tax.receiptFileName || undefined,
      accountId: accountId || undefined,
      userId,
    });

    await expense.save();

    tax.status = 'paid';
    tax.paidAt = new Date();
    tax.expenseId = expense._id;
    if (paymentMethod) tax.paymentMethod = paymentMethod;
    if (bankAccountName !== undefined) tax.bankAccountName = bankAccountName ? bankAccountName.trim() : undefined;
    if (bankAccountNumber !== undefined) tax.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : undefined;
    if (receiptUrl) tax.receiptUrl = receiptUrl;
    if (receiptFileName) tax.receiptFileName = receiptFileName;

    await tax.save();

    res.json({ data: { tax, expense } });
  } catch (error) {
    console.error('Error marking tax paid:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to mark tax as paid' });
  }
};

export const deleteTax = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete taxes' });
    }

    const tax = await Tax.findOneAndDelete({ _id: req.params.id, userId, status: 'pending' });
    if (!tax) {
      return res.status(404).json({ error: 'Tax not found or already paid' });
    }

    res.json({ message: 'Tax deleted successfully', data: tax });
  } catch (error) {
    console.error('Error deleting tax:', error);
    res.status(500).json({ error: 'Failed to delete tax' });
  }
};
