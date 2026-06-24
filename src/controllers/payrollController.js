import Payroll from '../models/Payroll.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

const normalizePayrollDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

export const getPayrolls = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { startDate, endDate, period } = req.query;
    const query = buildListQuery(req);

    if (period) query.period = period;

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.paymentDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.paymentDate.$lte = end;
      }
    }

    const payrolls = await Payroll.find(query).sort({ paymentDate: -1, createdAt: -1 });
    res.json({ data: payrolls });
  } catch (error) {
    console.error('Error fetching payrolls:', error);
    handleScopeError(res, error);
  }
};

export const getPayroll = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const payroll = await Payroll.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    res.json({ data: payroll });
  } catch (error) {
    console.error('Error fetching payroll:', error);
    handleScopeError(res, error);
  }
};

export const createPayroll = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');

    const {
      employeeName,
      amount,
      period,
      paymentDate,
      status,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
      accountId,
    } = req.body;

    const payroll = new Payroll({
      employeeName: employeeName?.trim(),
      amount: Number(amount),
      period: period?.trim(),
      paymentDate: normalizePayrollDate(paymentDate),
      status: status || 'paid',
      note: note ? note.trim() : undefined,
      paymentMethod: paymentMethod || 'transfer',
      bankAccountName: bankAccountName ? bankAccountName.trim() : undefined,
      bankAccountNumber: bankAccountNumber ? bankAccountNumber.trim() : undefined,
      accountId: accountId || undefined,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      ...buildCreateScope(req),
    });

    await payroll.save();
    res.status(201).json({ data: payroll });
  } catch (error) {
    console.error('Error creating payroll:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create payroll' });
  }
};

export const updatePayroll = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const payroll = await Payroll.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    const {
      employeeName,
      amount,
      period,
      paymentDate,
      status,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
      accountId,
    } = req.body;

    if (employeeName !== undefined) payroll.employeeName = employeeName?.trim();
    if (amount !== undefined) payroll.amount = Number(amount);
    if (period !== undefined) payroll.period = period?.trim();
    if (paymentDate !== undefined) payroll.paymentDate = normalizePayrollDate(paymentDate);
    if (status !== undefined) payroll.status = status;
    if (note !== undefined) payroll.note = note ? note.trim() : undefined;
    if (paymentMethod !== undefined) payroll.paymentMethod = paymentMethod;
    if (bankAccountName !== undefined) payroll.bankAccountName = bankAccountName ? bankAccountName.trim() : undefined;
    if (bankAccountNumber !== undefined) payroll.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : undefined;
    if (accountId !== undefined) payroll.accountId = accountId || undefined;
    if (receiptUrl !== undefined) payroll.receiptUrl = receiptUrl || undefined;
    if (receiptFileName !== undefined) payroll.receiptFileName = receiptFileName || undefined;

    await payroll.save();
    res.json({ data: payroll });
  } catch (error) {
    console.error('Error updating payroll:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update payroll' });
  }
};

export const deletePayroll = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const payroll = await Payroll.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    res.json({ message: 'Payroll deleted successfully', data: payroll });
  } catch (error) {
    console.error('Error deleting payroll:', error);
    handleScopeError(res, error);
  }
};
