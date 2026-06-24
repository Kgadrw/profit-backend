import CategoryBudget from '../models/CategoryBudget.js';
import Expense from '../models/Expense.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
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

const pickBudgetFields = (body) => {
  const referenceDate = body.referenceDate !== undefined ? normalizeMoneyDate(body.referenceDate) : new Date();
  const budgetPeriod = body.budgetPeriod || 'monthly';
  const { periodStart, periodEnd } = computeBudgetPeriodBounds(
    referenceDate,
    budgetPeriod,
    body.periodStart,
    body.periodEnd,
  );

  return {
    category: body.category?.trim(),
    amount: Number(body.amount),
    budgetPeriod,
    periodStart,
    periodEnd,
    note: body.note !== undefined ? (body.note ? body.note.trim() : undefined) : undefined,
  };
};

export const getCategoryBudgets = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const budgets = await CategoryBudget.find(buildListQuery(req)).sort({ category: 1, periodStart: -1 });
    res.json({ data: budgets });
  } catch (error) {
    console.error('Error fetching category budgets:', error);
    handleScopeError(res, error);
  }
};

export const createCategoryBudget = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');

    const fields = pickBudgetFields(req.body);
    if (!fields.category) {
      return res.status(400).json({ error: 'Category is required' });
    }
    if (!Number.isFinite(fields.amount) || fields.amount < 0) {
      return res.status(400).json({ error: 'Valid budget amount is required' });
    }

    const budget = new CategoryBudget({ ...fields, ...buildCreateScope(req) });
    await budget.save();
    res.status(201).json({ data: budget });
  } catch (error) {
    console.error('Error creating category budget:', error);
    res.status(500).json({ error: 'Failed to create category budget' });
  }
};

export const updateCategoryBudget = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');

    const budget = await CategoryBudget.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!budget) {
      return res.status(404).json({ error: 'Category budget not found' });
    }

    if (req.body.category !== undefined) budget.category = req.body.category.trim();
    if (req.body.amount !== undefined) budget.amount = Number(req.body.amount);
    if (req.body.note !== undefined) budget.note = req.body.note ? req.body.note.trim() : undefined;

    if (
      req.body.budgetPeriod !== undefined ||
      req.body.referenceDate !== undefined ||
      req.body.periodStart !== undefined ||
      req.body.periodEnd !== undefined
    ) {
      const fields = pickBudgetFields({
        ...budget.toObject(),
        ...req.body,
        referenceDate: req.body.referenceDate || budget.periodStart,
      });
      budget.budgetPeriod = fields.budgetPeriod;
      budget.periodStart = fields.periodStart;
      budget.periodEnd = fields.periodEnd;
    }

    await budget.save();
    res.json({ data: budget });
  } catch (error) {
    console.error('Error updating category budget:', error);
    res.status(500).json({ error: 'Failed to update category budget' });
  }
};

export const deleteCategoryBudget = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const budget = await CategoryBudget.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!budget) {
      return res.status(404).json({ error: 'Category budget not found' });
    }

    res.json({ message: 'Category budget deleted successfully' });
  } catch (error) {
    console.error('Error deleting category budget:', error);
    res.status(500).json({ error: 'Failed to delete category budget' });
  }
};

export const getCategoryBudgetSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);

    const viewPeriod = req.query.viewPeriod || 'monthly';
    const referenceDate = req.query.referenceDate ? new Date(req.query.referenceDate) : new Date();
    const { periodStart, periodEnd } = getViewPeriodBounds(viewPeriod, referenceDate);

    const budgets = await CategoryBudget.find(scope);
    const overlapping = budgets.filter((b) =>
      periodsOverlap(b.periodStart, b.periodEnd, periodStart, periodEnd),
    );

    const expenses = await Expense.find({
      ...scope,
      date: { $gte: startOfDay(periodStart), $lte: endOfDay(periodEnd) },
    }).lean();

    const actualByCategory = new Map();
    for (const expense of expenses) {
      const cat = (expense.category || 'general').trim().toLowerCase();
      actualByCategory.set(cat, (actualByCategory.get(cat) || 0) + (Number(expense.amount) || 0));
    }

    const budgetByCategory = new Map();
    for (const budget of overlapping) {
      const cat = budget.category.trim().toLowerCase();
      budgetByCategory.set(cat, (budgetByCategory.get(cat) || 0) + (Number(budget.amount) || 0));
    }

    const categories = new Set([...budgetByCategory.keys(), ...actualByCategory.keys()]);
    const rows = [...categories].map((category) => {
      const budget = budgetByCategory.get(category) || 0;
      const actual = actualByCategory.get(category) || 0;
      return {
        category,
        budget,
        actual,
        remaining: budget - actual,
        overBudget: actual > budget && budget > 0,
      };
    }).sort((a, b) => b.actual - a.actual);

    const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
    const totalActual = rows.reduce((s, r) => s + r.actual, 0);

    res.json({
      data: {
        viewPeriod,
        periodStart,
        periodEnd,
        rows,
        totalBudget,
        totalActual,
        totalRemaining: totalBudget - totalActual,
      },
    });
  } catch (error) {
    console.error('Error fetching category budget summary:', error);
    res.status(500).json({ error: 'Failed to fetch category budget summary' });
  }
};
