import Account from '../models/Account.js';
import AccountTransfer from '../models/AccountTransfer.js';
import Income from '../models/Income.js';
import Expense from '../models/Expense.js';
import Payroll from '../models/Payroll.js';
import { computeBalanceAsOf, parseStatementDates } from '../utils/accountBalanceUtils.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

async function computeBalance(req, accountId) {
  return computeBalanceAsOf(accountId, buildListQuery(req));
}

export const getAccounts = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const accounts = await Account.find({ ...buildListQuery(req), isActive: true }).sort({ isDefault: -1, name: 1 });
    const withBalances = await Promise.all(
      accounts.map(async (account) => {
        const balance = await computeBalance(req, account._id);
        return { ...account.toObject(), balance };
      }),
    );

    res.json({ data: withBalances });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    handleScopeError(res, error);
  }
};

export const getAccount = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const account = await Account.findOne({ ...buildListQuery(req, { _id: req.params.id }), isActive: true });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const balance = await computeBalance(req, account._id);
    res.json({ data: { ...account.toObject(), balance } });
  } catch (error) {
    console.error('Error fetching account:', error);
    handleScopeError(res, error);
  }
};

export const createAccount = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildCreateScope(req);
    const { name, type, institution, accountNumber, openingBalance, openingBalanceDate, isDefault, notes } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Account name is required' });
    }

    if (isDefault) {
      await Account.updateMany({ ...buildListQuery(req), isDefault: true }, { isDefault: false });
    }

    const account = new Account({
      name: name.trim(),
      type: type || 'cash',
      institution: institution ? institution.trim() : undefined,
      accountNumber: accountNumber ? accountNumber.trim() : undefined,
      openingBalance: Number(openingBalance) || 0,
      openingBalanceDate: openingBalanceDate ? new Date(openingBalanceDate) : new Date(),
      isDefault: Boolean(isDefault),
      notes: notes ? notes.trim() : undefined,
      ...scope,
    });

    await account.save();
    const balance = await computeBalance(req, account._id);
    res.status(201).json({ data: { ...account.toObject(), balance } });
  } catch (error) {
    console.error('Error creating account:', error);
    handleScopeError(res, error);
  }
};

export const updateAccount = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const account = await Account.findOne({ ...buildListQuery(req, { _id: req.params.id }), isActive: true });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const { name, type, institution, accountNumber, openingBalance, openingBalanceDate, isDefault, notes } = req.body;

    if (name !== undefined) account.name = name.trim();
    if (type !== undefined) account.type = type;
    if (institution !== undefined) account.institution = institution ? institution.trim() : undefined;
    if (accountNumber !== undefined) account.accountNumber = accountNumber ? accountNumber.trim() : undefined;
    if (openingBalance !== undefined) account.openingBalance = Number(openingBalance) || 0;
    if (openingBalanceDate !== undefined) {
      account.openingBalanceDate = openingBalanceDate ? new Date(openingBalanceDate) : account.openingBalanceDate;
    }
    if (notes !== undefined) account.notes = notes ? notes.trim() : undefined;
    if (isDefault !== undefined) {
      if (isDefault) {
        await Account.updateMany({ ...buildListQuery(req), isDefault: true }, { isDefault: false });
      }
      account.isDefault = Boolean(isDefault);
    }

    await account.save();
    const balance = await computeBalance(req, account._id);
    res.json({ data: { ...account.toObject(), balance } });
  } catch (error) {
    console.error('Error updating account:', error);
    handleScopeError(res, error);
  }
};

export const deleteAccount = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const account = await Account.findOne({ ...buildListQuery(req, { _id: req.params.id }), isActive: true });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    account.isActive = false;
    await account.save();
    res.json({ message: 'Account archived successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    handleScopeError(res, error);
  }
};

export const getAccountActivity = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const account = await Account.findOne({ ...scope, _id: req.params.id, isActive: true });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const [incomes, expenses, transfersIn, transfersOut, balance] = await Promise.all([
      Income.find({ ...scope, accountId: account._id }).sort({ date: -1 }).limit(50).lean(),
      Expense.find({ ...scope, accountId: account._id }).sort({ date: -1 }).limit(50).lean(),
      AccountTransfer.find({ ...scope, toAccountId: account._id }).sort({ transferDate: -1 }).limit(25).lean(),
      AccountTransfer.find({ ...scope, fromAccountId: account._id }).sort({ transferDate: -1 }).limit(25).lean(),
      computeBalance(req, account._id),
    ]);

    res.json({
      data: {
        account: { ...account.toObject(), balance },
        incomes,
        expenses,
        transfersIn,
        transfersOut,
      },
    });
  } catch (error) {
    console.error('Error fetching account activity:', error);
    handleScopeError(res, error);
  }
};

export const createTransfer = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const createScope = buildCreateScope(req);
    const { fromAccountId, toAccountId, amount, transferDate, referenceNumber, note } = req.body;
    const parsedAmount = Number(amount);

    if (!fromAccountId || !toAccountId) {
      return res.status(400).json({ error: 'From and to accounts are required' });
    }
    if (String(fromAccountId) === String(toAccountId)) {
      return res.status(400).json({ error: 'Cannot transfer to the same account' });
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Valid transfer amount is required' });
    }

    const [fromAccount, toAccount] = await Promise.all([
      Account.findOne({ ...scope, _id: fromAccountId, isActive: true }),
      Account.findOne({ ...scope, _id: toAccountId, isActive: true }),
    ]);

    if (!fromAccount || !toAccount) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const fromBalance = await computeBalance(req, fromAccount._id);
    if (fromBalance !== null && fromBalance < parsedAmount) {
      return res.status(400).json({ error: 'Insufficient balance in source account' });
    }

    const transfer = new AccountTransfer({
      fromAccountId: fromAccount._id,
      toAccountId: toAccount._id,
      amount: parsedAmount,
      transferDate: transferDate ? new Date(transferDate) : new Date(),
      referenceNumber: referenceNumber ? referenceNumber.trim() : undefined,
      note: note ? note.trim() : undefined,
      ...createScope,
    });

    await transfer.save();
    res.status(201).json({ data: transfer });
  } catch (error) {
    console.error('Error creating transfer:', error);
    handleScopeError(res, error);
  }
};

export const getTransfers = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const transfers = await AccountTransfer.find(buildListQuery(req))
      .sort({ transferDate: -1, createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ data: transfers });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    handleScopeError(res, error);
  }
};

export const getAccountReconciliation = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const account = await Account.findOne({ ...scope, _id: req.params.id, isActive: true });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const { start, end } = parseStatementDates(req.query.startDate, req.query.endDate);
    const dateRange = { $gte: start, $lte: end };

    const [incomes, expenses, payrolls, transfersIn, transfersOut, openingBalance, closingBalance] = await Promise.all([
      Income.find({ ...scope, accountId: account._id, date: dateRange }).sort({ date: -1 }).lean(),
      Expense.find({ ...scope, accountId: account._id, date: dateRange }).sort({ date: -1 }).lean(),
      Payroll.find({ ...scope, accountId: account._id, status: 'paid', paymentDate: dateRange }).sort({ paymentDate: -1 }).lean(),
      AccountTransfer.find({ ...scope, toAccountId: account._id, transferDate: dateRange }).sort({ transferDate: -1 }).lean(),
      AccountTransfer.find({ ...scope, fromAccountId: account._id, transferDate: dateRange }).sort({ transferDate: -1 }).lean(),
      computeBalanceAsOf(account._id, scope, new Date(start.getTime() - 1)),
      computeBalanceAsOf(account._id, scope, end),
    ]);

    const entries = [
      ...incomes.map((row) => ({
        id: String(row._id),
        type: 'income',
        date: row.date,
        description: row.title,
        amount: row.amount,
        direction: 'in',
        reconciled: Boolean(row.reconciledAt),
        reconciledAt: row.reconciledAt,
      })),
      ...expenses.map((row) => ({
        id: String(row._id),
        type: 'expense',
        date: row.date,
        description: row.title,
        amount: row.amount,
        direction: 'out',
        reconciled: Boolean(row.reconciledAt),
        reconciledAt: row.reconciledAt,
      })),
      ...payrolls.map((row) => ({
        id: String(row._id),
        type: 'payroll',
        date: row.paymentDate,
        description: `Payroll: ${row.employeeName}`,
        amount: row.amount,
        direction: 'out',
        reconciled: false,
      })),
      ...transfersIn.map((row) => ({
        id: String(row._id),
        type: 'transfer',
        date: row.transferDate,
        description: row.note || 'Transfer in',
        amount: row.amount,
        direction: 'in',
        reconciled: Boolean(row.reconciledAt),
        reconciledAt: row.reconciledAt,
      })),
      ...transfersOut.map((row) => ({
        id: String(row._id),
        type: 'transfer',
        date: row.transferDate,
        description: row.note || 'Transfer out',
        amount: row.amount,
        direction: 'out',
        reconciled: Boolean(row.reconciledAt),
        reconciledAt: row.reconciledAt,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const periodIn = entries.filter((e) => e.direction === 'in').reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const periodOut = entries.filter((e) => e.direction === 'out').reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const reconciledCount = entries.filter((e) => e.reconciled).length;

    res.json({
      data: {
        account: { ...account.toObject(), balance: closingBalance },
        periodStart: start,
        periodEnd: end,
        openingBalance: openingBalance ?? (Number(account.openingBalance) || 0),
        closingBalance: closingBalance ?? 0,
        periodIn,
        periodOut,
        reconciledCount,
        unreconciledCount: entries.length - reconciledCount,
        entries,
      },
    });
  } catch (error) {
    console.error('Error fetching reconciliation:', error);
    handleScopeError(res, error);
  }
};

export const toggleReconciliation = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const { type, id, reconciled } = req.body;
    if (!type || !id) {
      return res.status(400).json({ error: 'Transaction type and id are required' });
    }

    const reconciledAt = reconciled === false ? null : new Date();
    let updated;

    if (type === 'income') {
      updated = await Income.findOneAndUpdate(
        { ...scope, _id: id },
        { reconciledAt },
        { new: true },
      );
    } else if (type === 'expense') {
      updated = await Expense.findOneAndUpdate(
        { ...scope, _id: id },
        { reconciledAt },
        { new: true },
      );
    } else if (type === 'transfer') {
      updated = await AccountTransfer.findOneAndUpdate(
        { ...scope, _id: id },
        { reconciledAt },
        { new: true },
      );
    } else {
      return res.status(400).json({ error: 'Invalid transaction type' });
    }

    if (!updated) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ data: updated });
  } catch (error) {
    console.error('Error toggling reconciliation:', error);
    handleScopeError(res, error);
  }
};
