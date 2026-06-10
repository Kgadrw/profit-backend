// Recurring expense API handlers
import RecurringExpense from '../models/RecurringExpense.js';
import Expense from '../models/Expense.js';
import {
  createExpenseFromRecurring as createExpenseFromRecurringUtil,
  advanceRecurringExpense as advanceRecurringExpenseUtil,
} from '../utils/recurringExpenseUtils.js';

const normalizeDueDate = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T08:00:00`);
    return parsed;
  }
  const parsed = new Date(value);
  parsed.setHours(8, 0, 0, 0);
  return parsed;
};

const getUserId = (req, res) => {
  const userId = req.user._id === 'admin' ? null : req.user._id;
  if (!userId) {
    res.status(403).json({ error: 'Admin cannot access recurring expense data' });
    return null;
  }
  return userId;
};

export const getRecurringExpenses = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;

    const items = await RecurringExpense.find({ userId }).sort({ nextDueDate: 1, createdAt: -1 });
    res.json({ data: items });
  } catch (error) {
    console.error('Error fetching recurring expenses:', error);
    res.status(500).json({ error: 'Failed to fetch recurring expenses' });
  }
};

export const createRecurringExpense = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;

    const {
      title,
      amount,
      category,
      note,
      frequency,
      intervalDays,
      nextDueDate,
      autoRecord,
      notifyEmail,
      advanceNotificationDays,
      repeatUntil,
    } = req.body;

    const item = new RecurringExpense({
      title: title?.trim(),
      amount: Number(amount),
      category: category ? category.trim() : 'general',
      note: note ? note.trim() : undefined,
      frequency: frequency || 'monthly',
      intervalDays: frequency === 'custom' ? Number(intervalDays) || 30 : undefined,
      nextDueDate: normalizeDueDate(nextDueDate),
      autoRecord: Boolean(autoRecord),
      notifyEmail: notifyEmail !== false,
      advanceNotificationDays:
        advanceNotificationDays === undefined || advanceNotificationDays === null
          ? 1
          : Number(advanceNotificationDays),
      repeatUntil: repeatUntil ? normalizeDueDate(repeatUntil) : undefined,
      userId,
    });

    await item.save();
    res.status(201).json({ data: item });
  } catch (error) {
    console.error('Error creating recurring expense:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create recurring expense' });
  }
};

export const updateRecurringExpense = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;

    const item = await RecurringExpense.findOne({ _id: req.params.id, userId });
    if (!item) {
      return res.status(404).json({ error: 'Recurring expense not found' });
    }

    const fields = [
      'title',
      'amount',
      'category',
      'note',
      'frequency',
      'intervalDays',
      'nextDueDate',
      'autoRecord',
      'notifyEmail',
      'advanceNotificationDays',
      'repeatUntil',
      'active',
    ];

    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'title') item.title = req.body.title?.trim();
      else if (field === 'amount') item.amount = Number(req.body.amount);
      else if (field === 'category') item.category = req.body.category ? req.body.category.trim() : 'general';
      else if (field === 'note') item.note = req.body.note ? req.body.note.trim() : undefined;
      else if (field === 'frequency') item.frequency = req.body.frequency;
      else if (field === 'intervalDays') item.intervalDays = Number(req.body.intervalDays) || 30;
      else if (field === 'nextDueDate') item.nextDueDate = normalizeDueDate(req.body.nextDueDate);
      else if (field === 'autoRecord') item.autoRecord = Boolean(req.body.autoRecord);
      else if (field === 'notifyEmail') item.notifyEmail = Boolean(req.body.notifyEmail);
      else if (field === 'advanceNotificationDays') item.advanceNotificationDays = Number(req.body.advanceNotificationDays);
      else if (field === 'repeatUntil') {
        item.repeatUntil = req.body.repeatUntil ? normalizeDueDate(req.body.repeatUntil) : undefined;
      } else if (field === 'active') item.active = Boolean(req.body.active);
    }

    await item.save();
    res.json({ data: item });
  } catch (error) {
    console.error('Error updating recurring expense:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update recurring expense' });
  }
};

export const deleteRecurringExpense = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;

    const item = await RecurringExpense.findOneAndDelete({ _id: req.params.id, userId });
    if (!item) {
      return res.status(404).json({ error: 'Recurring expense not found' });
    }

    res.json({ message: 'Recurring expense deleted', data: item });
  } catch (error) {
    console.error('Error deleting recurring expense:', error);
    res.status(500).json({ error: 'Failed to delete recurring expense' });
  }
};

export const markRecurringExpensePaid = async (req, res) => {
  try {
    const userId = getUserId(req, res);
    if (!userId) return;

    const item = await RecurringExpense.findOne({ _id: req.params.id, userId, active: true });
    if (!item) {
      return res.status(404).json({ error: 'Recurring expense not found' });
    }

    const expense = await createExpenseFromRecurringUtil(Expense, item, userId, item.nextDueDate);
    const updated = await advanceRecurringExpenseUtil(item);

    res.json({
      message: 'Payment recorded and next due date scheduled',
      data: { recurring: updated, expense },
    });
  } catch (error) {
    console.error('Error marking recurring expense paid:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
};
