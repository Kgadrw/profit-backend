import Income from '../models/Income.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

const normalizeMoneyDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

const pickMoneyFields = (body, includeReceipt = true) => {
  const fields = {
    title: body.title?.trim(),
    amount: Number(body.amount),
    category: body.category ? body.category.trim() : 'general',
    source: body.source ? body.source.trim() : (body.category ? body.category.trim() : 'general'),
    date: body.date !== undefined ? normalizeMoneyDate(body.date) : undefined,
    note: body.note !== undefined ? (body.note ? body.note.trim() : undefined) : undefined,
    paymentMethod: body.paymentMethod || 'cash',
  };

  if (body.isRecurring !== undefined) {
    fields.isRecurring = Boolean(body.isRecurring);
  }
  if (body.recurrenceFrequency !== undefined || body.isRecurring !== undefined) {
    const recurring = body.isRecurring !== undefined ? Boolean(body.isRecurring) : Boolean(body.recurrenceFrequency);
    const frequency = String(body.recurrenceFrequency || '').toLowerCase();
    fields.recurrenceFrequency =
      recurring && ['weekly', 'monthly', 'yearly'].includes(frequency) ? frequency : '';
    if (body.isRecurring === undefined) {
      fields.isRecurring = Boolean(fields.recurrenceFrequency);
    }
  }

  if (body.bankAccountName !== undefined) {
    fields.bankAccountName = body.bankAccountName ? body.bankAccountName.trim() : undefined;
  }
  if (body.bankAccountNumber !== undefined) {
    fields.bankAccountNumber = body.bankAccountNumber ? body.bankAccountNumber.trim() : undefined;
  }
  if (body.clientId !== undefined) fields.clientId = body.clientId || undefined;
  if (body.invoiceId !== undefined) fields.invoiceId = body.invoiceId || undefined;
  if (body.accountId !== undefined) fields.accountId = body.accountId || undefined;

  if (includeReceipt) {
    if (body.receiptUrl !== undefined) fields.receiptUrl = body.receiptUrl || undefined;
    if (body.receiptFileName !== undefined) fields.receiptFileName = body.receiptFileName || undefined;
  }

  return fields;
};

export const getIncomes = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { startDate, endDate } = req.query;
    const query = buildListQuery(req);

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const incomes = await Income.find(query).sort({ date: -1, createdAt: -1 });
    res.json({ data: incomes });
  } catch (error) {
    console.error('Error fetching incomes:', error);
    handleScopeError(res, error);
  }
};

export const getIncome = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const income = await Income.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!income) {
      return res.status(404).json({ error: 'Income not found' });
    }

    res.json({ data: income });
  } catch (error) {
    console.error('Error fetching income:', error);
    handleScopeError(res, error);
  }
};

export const createIncome = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create incomes' });
    }

    const fields = pickMoneyFields(req.body);
    const income = new Income({
      ...fields,
      date: fields.date ?? normalizeMoneyDate(req.body.date),
      ...buildCreateScope(req),
    });

    await income.save();
    res.status(201).json({ data: income });
  } catch (error) {
    console.error('Error creating income:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const updateIncome = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const income = await Income.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!income) {
      return res.status(404).json({ error: 'Income not found' });
    }

    const fields = pickMoneyFields(req.body);
    Object.assign(income, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));

    await income.save();
    res.json({ data: income });
  } catch (error) {
    console.error('Error updating income:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const deleteIncome = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const income = await Income.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!income) {
      return res.status(404).json({ error: 'Income not found' });
    }

    res.json({ message: 'Income deleted successfully', data: income });
  } catch (error) {
    console.error('Error deleting income:', error);
    handleScopeError(res, error);
  }
};
