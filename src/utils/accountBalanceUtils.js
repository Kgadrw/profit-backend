import Income from '../models/Income.js';
import Expense from '../models/Expense.js';
import AccountTransfer from '../models/AccountTransfer.js';
import Payroll from '../models/Payroll.js';
import { startOfDay, endOfDay } from './budgetPeriodUtils.js';

export async function computeBalanceAsOf(accountId, scopeMatch, asOfDate = null) {
  const end = asOfDate ? endOfDay(asOfDate) : null;

  const incomeMatch = { ...scopeMatch, accountId };
  const expenseMatch = { ...scopeMatch, accountId };
  const transferInMatch = { ...scopeMatch, toAccountId: accountId };
  const transferOutMatch = { ...scopeMatch, fromAccountId: accountId };
  const payrollMatch = { ...scopeMatch, accountId, status: 'paid' };

  if (end) {
    incomeMatch.date = { $lte: end };
    expenseMatch.date = { $lte: end };
    transferInMatch.transferDate = { $lte: end };
    transferOutMatch.transferDate = { $lte: end };
    payrollMatch.paymentDate = { $lte: end };
  }

  const Account = (await import('../models/Account.js')).default;
  const account = await Account.findOne({ ...scopeMatch, _id: accountId, isActive: true });
  if (!account) return null;

  if (end && account.openingBalanceDate && new Date(account.openingBalanceDate) > end) {
    return 0;
  }

  const [incomeRows, expenseRows, transferInRows, transferOutRows, payrollRows] = await Promise.all([
    Income.aggregate([{ $match: incomeMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Expense.aggregate([{ $match: expenseMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    AccountTransfer.aggregate([{ $match: transferInMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    AccountTransfer.aggregate([{ $match: transferOutMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Payroll.aggregate([{ $match: payrollMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);

  const opening = Number(account.openingBalance) || 0;
  const inflow = (incomeRows[0]?.total || 0) + (transferInRows[0]?.total || 0);
  const outflow =
    (expenseRows[0]?.total || 0) + (transferOutRows[0]?.total || 0) + (payrollRows[0]?.total || 0);
  return opening + inflow - outflow;
}

export function parseStatementDates(startDate, endDate) {
  const end = endDate ? endOfDay(endDate) : endOfDay(new Date());
  const start = startDate
    ? startOfDay(startDate)
    : startOfDay(new Date(end.getFullYear(), end.getMonth(), 1));
  return { start, end };
}
