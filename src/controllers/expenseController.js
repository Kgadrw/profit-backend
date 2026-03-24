import Expense from '../models/Expense.js';

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
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access expense data' });
    }

    const { startDate, endDate } = req.query;
    const query = { userId };

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

    const expenses = await Expense.find(query).sort({ date: -1, createdAt: -1 });
    res.json({ data: expenses });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
};

// Get single expense
export const getExpense = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access expense data' });
    }

    const expense = await Expense.findOne({ _id: req.params.id, userId });
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ data: expense });
  } catch (error) {
    console.error('Error fetching expense:', error);
    res.status(500).json({ error: 'Failed to fetch expense' });
  }
};

// Create expense
export const createExpense = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create expenses' });
    }

    const { title, amount, category, date, note } = req.body;

    const expense = new Expense({
      title: title?.trim(),
      amount: Number(amount),
      category: category ? category.trim() : 'general',
      date: normalizeExpenseDate(date),
      note: note ? note.trim() : undefined,
      userId,
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
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update expenses' });
    }

    const { title, amount, category, date, note } = req.body;
    const expense = await Expense.findOne({ _id: req.params.id, userId });

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (title !== undefined) expense.title = title?.trim();
    if (amount !== undefined) expense.amount = Number(amount);
    if (category !== undefined) expense.category = category ? category.trim() : 'general';
    if (date !== undefined) expense.date = normalizeExpenseDate(date);
    if (note !== undefined) expense.note = note ? note.trim() : undefined;

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
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete expenses' });
    }

    const expense = await Expense.findOneAndDelete({ _id: req.params.id, userId });
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ message: 'Expense deleted successfully', data: expense });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
};

