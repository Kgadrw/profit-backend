import Invoice from '../models/Invoice.js';
import Income from '../models/Income.js';
import Client from '../models/Client.js';
import { buildListQuery, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

const normalizeInvoiceDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const advanceDate = (current, frequency) => {
  const d = new Date(current);
  if (frequency === 'quarterly') {
    d.setMonth(d.getMonth() + 3);
  } else if (frequency === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
};

const computeLineItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((row) => {
    const quantity = Number(row.quantity) || 0;
    const unitPrice = Number(row.unitPrice) || 0;
    const amount = row.amount !== undefined ? Number(row.amount) : quantity * unitPrice;
    return {
      description: String(row.description || '').trim(),
      quantity,
      unitPrice,
      amount: Math.max(0, amount),
    };
  }).filter((row) => row.description);
};

const sumLineItems = (items) => items.reduce((sum, row) => sum + (row.amount || 0), 0);

async function generateInvoiceNumber(userId) {
  const year = new Date().getFullYear();
  const count = await Invoice.countDocuments({
    userId,
    createdAt: {
      $gte: new Date(year, 0, 1),
      $lte: new Date(year, 11, 31, 23, 59, 59, 999),
    },
  });
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function syncClientSnapshot(clientId, userId) {
  if (!clientId) return {};
  const client = await Client.findOne({ _id: clientId, userId });
  if (!client) return {};
  return {
    clientId: client._id,
    clientName: client.name,
    clientEmail: client.email,
    clientPhone: client.phone,
  };
}

function refreshInvoiceStatus(invoice) {
  if (invoice.status === 'paid' || invoice.status === 'draft') return;
  const today = startOfDay(new Date());
  const due = startOfDay(invoice.dueDate);
  if (due < today && invoice.status !== 'paid') {
    invoice.status = 'overdue';
  }
}

async function refreshOverdueInvoices(userId) {
  const today = startOfDay(new Date());
  await Invoice.updateMany(
    {
      userId,
      status: 'sent',
      dueDate: { $lt: today },
    },
    { $set: { status: 'overdue' } },
  );
}

export const getInvoices = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (userId) {
      await refreshOverdueInvoices(userId);
    }

    const { status, clientId } = req.query;
    const query = buildListQuery(req);
    if (status === 'draft' || status === 'sent' || status === 'paid' || status === 'overdue') {
      query.status = status;
    }
    if (clientId) {
      query.clientId = clientId;
    }

    const invoices = await Invoice.find(query).sort({ status: 1, dueDate: 1, createdAt: -1 });
    res.json({ data: invoices });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    handleScopeError(res, error);
  }
};

export const getInvoice = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access invoice data' });
    }

    const invoice = await Invoice.findOne({ _id: req.params.id, userId });
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    refreshInvoiceStatus(invoice);
    if (invoice.isModified()) await invoice.save();

    res.json({ data: invoice });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
};

export const getInvoiceSummary = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access invoice summary' });
    }

    await refreshOverdueInvoices(userId);

    const invoices = await Invoice.find({ userId }).lean();
    const unpaid = invoices.filter((inv) => ['sent', 'overdue', 'draft'].includes(inv.status) && inv.status !== 'paid');
    const receivable = invoices
      .filter((inv) => inv.status === 'sent' || inv.status === 'overdue')
      .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
    const overdue = invoices
      .filter((inv) => inv.status === 'overdue')
      .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
    const draftCount = invoices.filter((inv) => inv.status === 'draft').length;
    const paidTotal = invoices
      .filter((inv) => inv.status === 'paid')
      .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

    res.json({
      data: {
        receivable,
        overdue,
        draftCount,
        unpaidCount: unpaid.filter((inv) => inv.status !== 'draft').length,
        paidTotal,
        totalCount: invoices.length,
      },
    });
  } catch (error) {
    console.error('Error fetching invoice summary:', error);
    res.status(500).json({ error: 'Failed to fetch invoice summary' });
  }
};

export const createInvoice = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create invoices' });
    }

    const {
      title,
      clientId,
      lineItems,
      amount,
      issueDate,
      dueDate,
      note,
      terms,
      status,
      isRecurring,
      recurrenceFrequency,
      recurrenceEndDate,
      parentInvoiceId,
    } = req.body;

    const items = computeLineItems(lineItems);
    const total = items.length > 0 ? sumLineItems(items) : Number(amount);
    if (!title?.trim() || !Number.isFinite(total) || total < 0) {
      return res.status(400).json({ error: 'Title and valid amount are required' });
    }
    if (!dueDate) {
      return res.status(400).json({ error: 'Due date is required' });
    }

    const clientSnapshot = await syncClientSnapshot(clientId, userId);
    const invoiceNumber = await generateInvoiceNumber(userId);

    const invoice = new Invoice({
      invoiceNumber,
      title: title.trim(),
      ...clientSnapshot,
      lineItems: items,
      amount: total,
      issueDate: normalizeInvoiceDate(issueDate),
      dueDate: normalizeInvoiceDate(dueDate),
      status: status === 'sent' ? 'sent' : 'draft',
      sentAt: status === 'sent' ? new Date() : undefined,
      note: note ? note.trim() : undefined,
      terms: terms ? terms.trim() : undefined,
      isRecurring: Boolean(isRecurring),
      recurrenceFrequency: isRecurring ? (recurrenceFrequency || 'monthly') : undefined,
      recurrenceEndDate: recurrenceEndDate ? normalizeInvoiceDate(recurrenceEndDate) : undefined,
      parentInvoiceId: parentInvoiceId || undefined,
      userId,
    });

    refreshInvoiceStatus(invoice);
    await invoice.save();
    res.status(201).json({ data: invoice });
  } catch (error) {
    console.error('Error creating invoice:', error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Invoice number conflict, please retry' });
    }
    res.status(500).json({ error: 'Failed to create invoice' });
  }
};

export const updateInvoice = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update invoices' });
    }

    const invoice = await Invoice.findOne({ _id: req.params.id, userId });
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Cannot edit a paid invoice' });
    }

    const {
      title,
      clientId,
      lineItems,
      amount,
      issueDate,
      dueDate,
      note,
      terms,
      isRecurring,
      recurrenceFrequency,
      recurrenceEndDate,
    } = req.body;

    if (title !== undefined) invoice.title = title.trim();
    if (clientId !== undefined) {
      const snapshot = await syncClientSnapshot(clientId, userId);
      invoice.clientId = snapshot.clientId;
      invoice.clientName = snapshot.clientName;
      invoice.clientEmail = snapshot.clientEmail;
      invoice.clientPhone = snapshot.clientPhone;
    }
    if (lineItems !== undefined) {
      const items = computeLineItems(lineItems);
      invoice.lineItems = items;
      invoice.amount = items.length > 0 ? sumLineItems(items) : Number(amount) || invoice.amount;
    } else if (amount !== undefined) {
      invoice.amount = Number(amount);
    }
    if (issueDate !== undefined) invoice.issueDate = normalizeInvoiceDate(issueDate);
    if (dueDate !== undefined) invoice.dueDate = normalizeInvoiceDate(dueDate);
    if (note !== undefined) invoice.note = note ? note.trim() : undefined;
    if (terms !== undefined) invoice.terms = terms ? terms.trim() : undefined;
    if (isRecurring !== undefined) invoice.isRecurring = Boolean(isRecurring);
    if (recurrenceFrequency !== undefined) invoice.recurrenceFrequency = recurrenceFrequency;
    if (recurrenceEndDate !== undefined) {
      invoice.recurrenceEndDate = recurrenceEndDate ? normalizeInvoiceDate(recurrenceEndDate) : undefined;
    }

    if (invoice.status === 'overdue' || invoice.status === 'sent') {
      refreshInvoiceStatus(invoice);
    }

    await invoice.save();
    res.json({ data: invoice });
  } catch (error) {
    console.error('Error updating invoice:', error);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
};

export const markInvoiceSent = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update invoices' });
    }

    const invoice = await Invoice.findOne({ _id: req.params.id, userId });
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Invoice is already paid' });
    }

    invoice.status = 'sent';
    invoice.sentAt = new Date();
    refreshInvoiceStatus(invoice);
    await invoice.save();

    res.json({ data: invoice });
  } catch (error) {
    console.error('Error marking invoice sent:', error);
    res.status(500).json({ error: 'Failed to mark invoice as sent' });
  }
};

async function createRecurringDraft(parent, userId) {
  if (!parent.isRecurring || !parent.recurrenceFrequency) return null;

  const nextIssue = advanceDate(parent.issueDate, parent.recurrenceFrequency);
  const nextDue = advanceDate(parent.dueDate, parent.recurrenceFrequency);

  if (parent.recurrenceEndDate && nextDue > parent.recurrenceEndDate) {
    return null;
  }

  const invoiceNumber = await generateInvoiceNumber(userId);
  const draft = new Invoice({
    invoiceNumber,
    title: parent.title,
    clientId: parent.clientId,
    clientName: parent.clientName,
    clientEmail: parent.clientEmail,
    clientPhone: parent.clientPhone,
    lineItems: parent.lineItems,
    amount: parent.amount,
    issueDate: nextIssue,
    dueDate: nextDue,
    status: 'draft',
    note: parent.note,
    terms: parent.terms,
    isRecurring: true,
    recurrenceFrequency: parent.recurrenceFrequency,
    recurrenceEndDate: parent.recurrenceEndDate,
    parentInvoiceId: parent._id,
    userId,
  });

  await draft.save();
  return draft;
}

export const markInvoicePaid = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update invoices' });
    }

    const invoice = await Invoice.findOne({ _id: req.params.id, userId });
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Invoice is already paid' });
    }

    const {
      paymentMethod,
      paymentDate,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
      accountId,
    } = req.body;

    const incomeNote = [
      invoice.clientName ? `Customer: ${invoice.clientName}` : null,
      `Invoice: ${invoice.invoiceNumber}`,
      invoice.note || null,
    ]
      .filter(Boolean)
      .join(' — ');

    const income = new Income({
      title: invoice.title,
      amount: invoice.amount,
      category: 'invoice',
      source: invoice.clientName || 'invoice',
      date: normalizeInvoiceDate(paymentDate),
      note: incomeNote || 'Invoice payment',
      paymentMethod: paymentMethod || invoice.paymentMethod || 'cash',
      bankAccountName: bankAccountName ? String(bankAccountName).trim() : invoice.bankAccountName,
      bankAccountNumber: bankAccountNumber ? String(bankAccountNumber).trim() : invoice.bankAccountNumber,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      clientId: invoice.clientId,
      invoiceId: invoice._id,
      accountId: accountId || undefined,
      userId,
    });

    await income.save();

    invoice.status = 'paid';
    invoice.paidAt = new Date();
    invoice.incomeId = income._id;
    if (paymentMethod) invoice.paymentMethod = paymentMethod;
    await invoice.save();

    const nextRecurring = await createRecurringDraft(invoice, userId);

    res.json({ data: { invoice, income, nextRecurring } });
  } catch (error) {
    console.error('Error marking invoice paid:', error);
    res.status(500).json({ error: 'Failed to mark invoice as paid' });
  }
};

export const deleteInvoice = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete invoices' });
    }

    const invoice = await Invoice.findOneAndDelete({
      _id: req.params.id,
      userId,
      status: { $in: ['draft', 'sent', 'overdue'] },
    });

    if (!invoice) {
      const exists = await Invoice.findOne({ _id: req.params.id, userId });
      if (exists?.status === 'paid') {
        return res.status(400).json({ error: 'Cannot delete a paid invoice' });
      }
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ message: 'Invoice deleted successfully', data: invoice });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
};
