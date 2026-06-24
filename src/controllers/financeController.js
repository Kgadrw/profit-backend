import Income from '../models/Income.js';
import Expense from '../models/Expense.js';
import Payroll from '../models/Payroll.js';
import BankDeposit from '../models/BankDeposit.js';
import Bill from '../models/Bill.js';
import Tax from '../models/Tax.js';
import Invoice from '../models/Invoice.js';
import Loan from '../models/Loan.js';
import Product from '../models/Product.js';
import Account from '../models/Account.js';
import AccountTransfer from '../models/AccountTransfer.js';
import { startOfDay, endOfDay } from '../utils/budgetPeriodUtils.js';
import { computeBalanceAsOf, parseStatementDates } from '../utils/accountBalanceUtils.js';
import { buildListQuery, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

export const getFinanceSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const match = buildListQuery(req);

    const [incomeAgg, expenseAgg, payrollAgg, incomeCount, expenseCount, payrollCount] = await Promise.all([
      Income.aggregate([
        { $match: match },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: match },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payroll.aggregate([
        { $match: { ...match, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Income.countDocuments(match),
      Expense.countDocuments(match),
      Payroll.countDocuments(match),
    ]);

    const totalIncome = incomeAgg[0]?.total || 0;
    const totalExpenses = expenseAgg[0]?.total || 0;
    const totalPayroll = payrollAgg[0]?.total || 0;
    const totalOutflow = totalExpenses + totalPayroll;

    res.json({
      data: {
        totalIncome,
        totalExpenses,
        totalPayroll,
        totalOutflow,
        balance: totalIncome - totalOutflow,
        incomeCount,
        expenseCount,
        payrollCount,
      },
    });
  } catch (error) {
    console.error('Error fetching finance summary:', error);
    handleScopeError(res, error);
  }
};

export const getIncomeBySource = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const match = buildListQuery(req);

    const rows = await Income.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $ifNull: [
              { $cond: [{ $eq: ['$source', ''] }, null, '$source'] },
              { $ifNull: ['$category', 'general'] },
            ],
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const totalIncome = rows.reduce((sum, r) => sum + (r.total || 0), 0);
    const sources = rows.map((r) => ({
      source: r._id || 'general',
      total: r.total,
      count: r.count,
      percentage: totalIncome > 0 ? Math.round((r.total / totalIncome) * 100) : 0,
    }));

    res.json({ data: { sources, totalIncome } });
  } catch (error) {
    console.error('Error fetching income by source:', error);
    handleScopeError(res, error);
  }
};

export const getTransactions = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const match = buildListQuery(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const [incomes, expenses, payrolls, deposits] = await Promise.all([
      Income.find(match).sort({ date: -1 }).limit(limit).lean(),
      Expense.find(match).sort({ date: -1 }).limit(limit).lean(),
      Payroll.find(match).sort({ paymentDate: -1 }).limit(limit).lean(),
      BankDeposit.find(match).sort({ depositDate: -1 }).limit(limit).lean(),
    ]);

    const transactions = [
      ...incomes.map((row) => ({
        id: String(row._id),
        type: 'income',
        title: row.title,
        amount: row.amount,
        date: row.date,
        meta: row.source || row.category || '',
        paymentMethod: row.paymentMethod,
        receiptUrl: row.receiptUrl,
        receiptFileName: row.receiptFileName,
      })),
      ...deposits.map((row) => ({
        id: String(row._id),
        type: 'deposit',
        title: row.title,
        amount: row.amount,
        date: row.depositDate,
        meta: row.budgetPeriod || '',
        bankAccountName: row.bankAccountName,
        bankAccountNumber: row.bankAccountNumber,
        receiptUrl: row.receiptUrl,
        receiptFileName: row.receiptFileName,
      })),
      ...expenses.map((row) => ({
        id: String(row._id),
        type: 'expense',
        title: row.title,
        amount: row.amount,
        date: row.date,
        meta: row.category || '',
        paymentMethod: row.paymentMethod,
        receiptUrl: row.receiptUrl,
        receiptFileName: row.receiptFileName,
      })),
      ...payrolls.map((row) => ({
        id: String(row._id),
        type: 'payroll',
        title: row.employeeName,
        amount: row.amount,
        date: row.paymentDate,
        meta: row.period || '',
        status: row.status,
        paymentMethod: row.paymentMethod,
        receiptUrl: row.receiptUrl,
        receiptFileName: row.receiptFileName,
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    res.json({ data: transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    handleScopeError(res, error);
  }
};

export const getProfitLoss = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const { start, end } = parseStatementDates(req.query.startDate, req.query.endDate);
    const dateRange = { $gte: start, $lte: end };

    const [incomeTotal, expenseRows, payrollTotal, incomeBySource] = await Promise.all([
      Income.aggregate([
        { $match: { ...scope, date: dateRange } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: { ...scope, date: dateRange } },
        { $group: { _id: { $ifNull: ['$category', 'general'] }, total: { $sum: '$amount' } } },
        { $sort: { total: -1 } },
      ]),
      Payroll.aggregate([
        { $match: { ...scope, status: 'paid', paymentDate: dateRange } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Income.aggregate([
        { $match: { ...scope, date: dateRange } },
        {
          $group: {
            _id: { $ifNull: [{ $cond: [{ $eq: ['$source', ''] }, null, '$source'] }, '$category'] },
            total: { $sum: '$amount' },
          },
        },
        { $sort: { total: -1 } },
      ]),
    ]);

    const revenue = incomeTotal[0]?.total || 0;
    const payroll = payrollTotal[0]?.total || 0;
    const expenses = expenseRows.reduce((s, r) => s + (r.total || 0), 0);
    const totalExpenses = expenses + payroll;
    const netProfit = revenue - totalExpenses;

    res.json({
      data: {
        periodStart: start,
        periodEnd: end,
        revenue,
        revenueLines: incomeBySource.map((r) => ({
          label: r._id || 'general',
          amount: r.total,
        })),
        expenseLines: expenseRows.map((r) => ({
          label: r._id || 'general',
          amount: r.total,
        })),
        payroll,
        totalExpenses,
        netProfit,
      },
    });
  } catch (error) {
    console.error('Error fetching profit and loss:', error);
    handleScopeError(res, error);
  }
};

export const getBalanceSheet = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const asOf = req.query.asOfDate ? endOfDay(req.query.asOfDate) : endOfDay(new Date());

    const accounts = await Account.find({ ...scope, isActive: true }).lean();
    const accountBalances = await Promise.all(
      accounts.map(async (account) => ({
        name: account.name,
        type: account.type,
        balance: await computeBalanceAsOf(account._id, scope, asOf),
      })),
    );
    const cashAndBank = accountBalances.reduce((s, a) => s + (a.balance || 0), 0);

    const [pendingBills, pendingTaxes, unpaidInvoices, loans, products] = await Promise.all([
      Bill.find({ ...scope, status: 'pending', dueDate: { $lte: asOf } }).lean(),
      Tax.find({ ...scope, status: { $ne: 'paid' }, dueDate: { $lte: asOf } }).lean(),
      Invoice.find({ ...scope, status: { $in: ['sent', 'overdue'] } }).lean(),
      Loan.find({ ...scope, status: { $in: ['active', 'overdue'] } }).lean(),
      Product.find({ ...scope, category: { $ne: 'service' } }).lean(),
    ]);

    const accountsReceivable = unpaidInvoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
    const accountsPayable =
      pendingBills.reduce((s, b) => s + (Number(b.amount) || 0), 0) +
      pendingTaxes.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const loanLiabilities = loans.reduce((s, l) => s + (Number(l.remainingBalance) || 0), 0);
    const inventoryValue = products.reduce(
      (s, p) => s + (Number(p.stock) || 0) * (Number(p.costPrice) || 0),
      0,
    );

    const totalAssets = cashAndBank + accountsReceivable + inventoryValue;
    const totalLiabilities = accountsPayable + loanLiabilities;
    const equity = totalAssets - totalLiabilities;

    res.json({
      data: {
        asOfDate: asOf,
        assets: {
          cashAndBank,
          accountBalances,
          accountsReceivable,
          inventoryValue,
          total: totalAssets,
        },
        liabilities: {
          accountsPayable,
          loanLiabilities,
          total: totalLiabilities,
        },
        equity,
      },
    });
  } catch (error) {
    console.error('Error fetching balance sheet:', error);
    handleScopeError(res, error);
  }
};

export const getCashFlow = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const { start, end } = parseStatementDates(req.query.startDate, req.query.endDate);
    const dateRange = { $gte: start, $lte: end };

    const [inflowAgg, expenseAgg, payrollAgg, depositAgg, transferInAgg, accounts] =
      await Promise.all([
        Income.aggregate([
          { $match: { ...scope, date: dateRange } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Expense.aggregate([
          { $match: { ...scope, date: dateRange } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Payroll.aggregate([
          { $match: { ...scope, status: 'paid', paymentDate: dateRange } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        BankDeposit.aggregate([
          { $match: { ...scope, depositDate: dateRange } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        AccountTransfer.aggregate([
          { $match: { ...scope, transferDate: dateRange } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Account.find({ ...scope, isActive: true }).lean(),
      ]);

    const operatingIn = inflowAgg[0]?.total || 0;
    const operatingOut = (expenseAgg[0]?.total || 0) + (payrollAgg[0]?.total || 0);
    const financingIn = depositAgg[0]?.total || 0;
    const netOperating = operatingIn - operatingOut;
    const netChange = netOperating + financingIn;

    const openingCash = accounts.reduce((s, a) => s + (Number(a.openingBalance) || 0), 0);
    const closingCash = openingCash + netChange;

    res.json({
      data: {
        periodStart: start,
        periodEnd: end,
        operating: {
          cashIn: operatingIn,
          cashOut: operatingOut,
          net: netOperating,
        },
        financing: {
          deposits: financingIn,
        },
        internalTransfers: {
          volume: transferInAgg[0]?.total || 0,
          note: 'Internal transfers net to zero across accounts',
        },
        netChangeInCash: netChange,
        openingCash,
        closingCash,
      },
    });
  } catch (error) {
    console.error('Error fetching cash flow:', error);
    handleScopeError(res, error);
  }
};
