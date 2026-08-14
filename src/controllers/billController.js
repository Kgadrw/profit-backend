import Bill from '../models/Bill.js';
import Expense from '../models/Expense.js';
import Vendor from '../models/Vendor.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import {
  assertRecordApproved,
  buildSubmissionFields,
  getInitialApprovalStatus,
  isWorkspaceApprovalEnabled,
} from '../utils/approvalWorkflow.js';

const resolveVendorFields = async (req, vendorId, vendorText) => {
  if (vendorId) {
    const vendor = await Vendor.findOne(buildListQuery(req, { _id: vendorId }));
    if (vendor) {
      return { vendorId: vendor._id, vendor: vendor.name };
    }
  }
  return {
    vendorId: undefined,
    vendor: vendorText ? String(vendorText).trim() : undefined,
  };
};

const normalizeBillDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

export const getBills = async (req, res) => {
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

    const bills = await Bill.find(query).sort({ status: 1, dueDate: 1, createdAt: -1 });
    res.json({ data: bills });
  } catch (error) {
    console.error('Error fetching bills:', error);
    handleScopeError(res, error);
  }
};

export const getBill = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const bill = await Bill.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    res.json({ data: bill });
  } catch (error) {
    console.error('Error fetching bill:', error);
    handleScopeError(res, error);
  }
};

export const createBill = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create bills' });
    }

    const {
      title,
      amount,
      vendor,
      vendorId,
      category,
      dueDate,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
      isRecurring,
      recurrenceFrequency,
    } = req.body;

    const vendorFields = await resolveVendorFields(req, vendorId, vendor);
    const approvalStatus = getInitialApprovalStatus(req);
    const recurring = Boolean(isRecurring);
    const frequency = String(recurrenceFrequency || '').toLowerCase();
    const normalizedFrequency =
      recurring && ['weekly', 'monthly', 'yearly'].includes(frequency) ? frequency : '';

    const bill = new Bill({
      title: title?.trim(),
      amount: Number(amount),
      vendor: vendorFields.vendor,
      vendorId: vendorFields.vendorId,
      category: category ? category.trim() : 'bills',
      dueDate: normalizeBillDate(dueDate),
      status: 'pending',
      note: note ? note.trim() : undefined,
      isRecurring: recurring,
      recurrenceFrequency: normalizedFrequency,
      paymentMethod: paymentMethod || 'cash',
      bankAccountName: bankAccountName ? bankAccountName.trim() : undefined,
      bankAccountNumber: bankAccountNumber ? bankAccountNumber.trim() : undefined,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      approvalStatus,
      ...buildSubmissionFields(req, approvalStatus),
      ...buildCreateScope(req),
    });

    await bill.save();
    res.status(201).json({ data: bill });
  } catch (error) {
    console.error('Error creating bill:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const updateBill = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update bills' });
    }

    const bill = await Bill.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    if (bill.status === 'paid') {
      return res.status(400).json({ error: 'Paid bills cannot be edited' });
    }

    if (isWorkspaceApprovalEnabled(req) && bill.approvalStatus === 'pending_approval') {
      return res.status(400).json({ error: 'Pending bills cannot be edited. Wait for approval or delete and recreate.' });
    }

    const {
      title,
      amount,
      vendor,
      vendorId,
      category,
      dueDate,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
      isRecurring,
      recurrenceFrequency,
    } = req.body;

    if (title !== undefined) bill.title = title?.trim();
    if (amount !== undefined) bill.amount = Number(amount);
    if (vendor !== undefined || vendorId !== undefined) {
      const vendorFields = await resolveVendorFields(
        req,
        vendorId !== undefined ? vendorId : bill.vendorId,
        vendor !== undefined ? vendor : bill.vendor,
      );
      bill.vendor = vendorFields.vendor;
      bill.vendorId = vendorFields.vendorId;
    }
    if (category !== undefined) bill.category = category ? category.trim() : 'bills';
    if (dueDate !== undefined) bill.dueDate = normalizeBillDate(dueDate);
    if (note !== undefined) bill.note = note ? note.trim() : undefined;
    if (isRecurring !== undefined || recurrenceFrequency !== undefined) {
      const recurring = isRecurring !== undefined ? Boolean(isRecurring) : Boolean(recurrenceFrequency);
      const frequency = String(recurrenceFrequency || bill.recurrenceFrequency || '').toLowerCase();
      bill.isRecurring = recurring;
      bill.recurrenceFrequency =
        recurring && ['weekly', 'monthly', 'yearly'].includes(frequency) ? frequency : '';
    }
    if (paymentMethod !== undefined) bill.paymentMethod = paymentMethod;
    if (bankAccountName !== undefined) bill.bankAccountName = bankAccountName ? bankAccountName.trim() : undefined;
    if (bankAccountNumber !== undefined) bill.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : undefined;
    if (receiptUrl !== undefined) bill.receiptUrl = receiptUrl || undefined;
    if (receiptFileName !== undefined) bill.receiptFileName = receiptFileName || undefined;

    if (isWorkspaceApprovalEnabled(req) && bill.approvalStatus === 'rejected') {
      bill.approvalStatus = 'pending_approval';
      Object.assign(bill, buildSubmissionFields(req, 'pending_approval'));
    }
    // changes_requested stays editable until the submitter explicitly resubmits

    await bill.save();
    res.json({ data: bill });
  } catch (error) {
    console.error('Error updating bill:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const markBillPaid = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update bills' });
    }

    const bill = await Bill.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    if (bill.status === 'paid') {
      return res.status(400).json({ error: 'Bill is already paid' });
    }

    try {
      assertRecordApproved(bill, 'mark this bill as paid');
    } catch (approvalError) {
      return res.status(approvalError.statusCode || 400).json({ error: approvalError.message });
    }

    const { paymentMethod, paymentDate, bankAccountName, bankAccountNumber, receiptUrl, receiptFileName, accountId } = req.body;

    const expenseNote = [
      bill.vendor ? `Vendor: ${bill.vendor}` : null,
      bill.note || null,
    ]
      .filter(Boolean)
      .join(' — ');

    const expense = new Expense({
      title: bill.title,
      amount: bill.amount,
      category: bill.category || 'bills',
      date: normalizeBillDate(paymentDate),
      note: expenseNote || 'Paid bill',
      vendorId: bill.vendorId || undefined,
      vendorName: bill.vendor || undefined,
      paymentMethod: paymentMethod || bill.paymentMethod || 'cash',
      bankAccountName: (bankAccountName || bill.bankAccountName)
        ? String(bankAccountName || bill.bankAccountName).trim()
        : undefined,
      bankAccountNumber: (bankAccountNumber || bill.bankAccountNumber)
        ? String(bankAccountNumber || bill.bankAccountNumber).trim()
        : undefined,
      receiptUrl: receiptUrl || bill.receiptUrl || undefined,
      receiptFileName: receiptFileName || bill.receiptFileName || undefined,
      accountId: accountId || undefined,
      approvalStatus: 'approved',
      ...buildCreateScope(req),
    });

    await expense.save();

    bill.status = 'paid';
    bill.paidAt = new Date();
    bill.expenseId = expense._id;
    if (paymentMethod) bill.paymentMethod = paymentMethod;
    if (bankAccountName !== undefined) bill.bankAccountName = bankAccountName ? bankAccountName.trim() : undefined;
    if (bankAccountNumber !== undefined) bill.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : undefined;
    if (receiptUrl) bill.receiptUrl = receiptUrl;
    if (receiptFileName) bill.receiptFileName = receiptFileName;

    await bill.save();

    res.json({ data: { bill, expense } });
  } catch (error) {
    console.error('Error marking bill paid:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const deleteBill = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete bills' });
    }

    const bill = await Bill.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    if (bill.status === 'paid') {
      return res.status(400).json({ error: 'Paid bills cannot be deleted' });
    }

    await Bill.deleteOne({ _id: bill._id });

    res.json({ message: 'Bill deleted' });
  } catch (error) {
    console.error('Error deleting bill:', error);
    handleScopeError(res, error);
  }
};
