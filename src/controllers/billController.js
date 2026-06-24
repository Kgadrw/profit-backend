import Bill from '../models/Bill.js';
import Expense from '../models/Expense.js';
import Vendor from '../models/Vendor.js';
import { buildListQuery, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

const resolveVendorFields = async (userId, vendorId, vendorText) => {
  if (vendorId) {
    const vendor = await Vendor.findOne({ _id: vendorId, userId });
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
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access bill data' });
    }

    const bill = await Bill.findOne({ _id: req.params.id, userId });
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    res.json({ data: bill });
  } catch (error) {
    console.error('Error fetching bill:', error);
    res.status(500).json({ error: 'Failed to fetch bill' });
  }
};

export const createBill = async (req, res) => {
  try {
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
    } = req.body;

    const vendorFields = await resolveVendorFields(userId, vendorId, vendor);

    const bill = new Bill({
      title: title?.trim(),
      amount: Number(amount),
      vendor: vendorFields.vendor,
      vendorId: vendorFields.vendorId,
      category: category ? category.trim() : 'bills',
      dueDate: normalizeBillDate(dueDate),
      status: 'pending',
      note: note ? note.trim() : undefined,
      paymentMethod: paymentMethod || 'cash',
      bankAccountName: bankAccountName ? bankAccountName.trim() : undefined,
      bankAccountNumber: bankAccountNumber ? bankAccountNumber.trim() : undefined,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      userId,
    });

    await bill.save();
    res.status(201).json({ data: bill });
  } catch (error) {
    console.error('Error creating bill:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create bill' });
  }
};

export const updateBill = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update bills' });
    }

    const bill = await Bill.findOne({ _id: req.params.id, userId });
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    if (bill.status === 'paid') {
      return res.status(400).json({ error: 'Paid bills cannot be edited' });
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
    } = req.body;

    if (title !== undefined) bill.title = title?.trim();
    if (amount !== undefined) bill.amount = Number(amount);
    if (vendor !== undefined || vendorId !== undefined) {
      const vendorFields = await resolveVendorFields(
        userId,
        vendorId !== undefined ? vendorId : bill.vendorId,
        vendor !== undefined ? vendor : bill.vendor,
      );
      bill.vendor = vendorFields.vendor;
      bill.vendorId = vendorFields.vendorId;
    }
    if (category !== undefined) bill.category = category ? category.trim() : 'bills';
    if (dueDate !== undefined) bill.dueDate = normalizeBillDate(dueDate);
    if (note !== undefined) bill.note = note ? note.trim() : undefined;
    if (paymentMethod !== undefined) bill.paymentMethod = paymentMethod;
    if (bankAccountName !== undefined) bill.bankAccountName = bankAccountName ? bankAccountName.trim() : undefined;
    if (bankAccountNumber !== undefined) bill.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : undefined;
    if (receiptUrl !== undefined) bill.receiptUrl = receiptUrl || undefined;
    if (receiptFileName !== undefined) bill.receiptFileName = receiptFileName || undefined;

    await bill.save();
    res.json({ data: bill });
  } catch (error) {
    console.error('Error updating bill:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update bill' });
  }
};

export const markBillPaid = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update bills' });
    }

    const bill = await Bill.findOne({ _id: req.params.id, userId });
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    if (bill.status === 'paid') {
      return res.status(400).json({ error: 'Bill is already paid' });
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
      userId,
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
    res.status(500).json({ error: 'Failed to mark bill as paid' });
  }
};

export const deleteBill = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete bills' });
    }

    const bill = await Bill.findOneAndDelete({ _id: req.params.id, userId, status: 'pending' });
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found or already paid' });
    }

    res.json({ message: 'Bill deleted successfully', data: bill });
  } catch (error) {
    console.error('Error deleting bill:', error);
    res.status(500).json({ error: 'Failed to delete bill' });
  }
};
