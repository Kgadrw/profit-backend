import Loan from '../models/Loan.js';
import Expense from '../models/Expense.js';
import { buildListQuery, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

const normalizeLoanDate = (value) => {
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

const advanceDueDate = (current, frequency) => {
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

const computeMaturityDate = (startDate, termMonths) => {
  if (!termMonths || termMonths <= 0) return undefined;
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + termMonths);
  return d;
};

const refreshLoanStatus = (loan) => {
  if (loan.remainingBalance <= 0) {
    loan.status = 'paid_off';
    return;
  }
  const today = startOfDay(new Date());
  const due = startOfDay(loan.nextDueDate);
  loan.status = due < today ? 'overdue' : 'active';
};

export const getLoans = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { status } = req.query;
    const query = buildListQuery(req);
    if (status === 'active' || status === 'paid_off' || status === 'overdue') {
      query.status = status;
    }

    const loans = await Loan.find(query).sort({ status: 1, nextDueDate: 1, createdAt: -1 });
    res.json({ data: loans });
  } catch (error) {
    console.error('Error fetching loans:', error);
    handleScopeError(res, error);
  }
};

export const getLoan = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access loan data' });
    }

    const loan = await Loan.findOne({ _id: req.params.id, userId });
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    res.json({ data: loan });
  } catch (error) {
    console.error('Error fetching loan:', error);
    res.status(500).json({ error: 'Failed to fetch loan' });
  }
};

export const getLoanSummary = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access loan summary' });
    }

    const loans = await Loan.find({ userId }).lean();
    const today = startOfDay(new Date());
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    const activeLoans = loans.filter((l) => l.status !== 'paid_off');
    const totalOutstanding = activeLoans.reduce((sum, l) => sum + (Number(l.remainingBalance) || 0), 0);
    const overdueLoans = activeLoans.filter((l) => startOfDay(l.nextDueDate) < today);
    const overdueAmount = overdueLoans.reduce((sum, l) => sum + (Number(l.installmentAmount) || 0), 0);
    const dueThisMonth = activeLoans.filter((l) => {
      const due = new Date(l.nextDueDate);
      return due >= today && due <= monthEnd;
    });
    const dueThisMonthAmount = dueThisMonth.reduce((sum, l) => sum + (Number(l.installmentAmount) || 0), 0);
    const totalPaidAll = loans.reduce((sum, l) => sum + (Number(l.totalPaid) || 0), 0);

    res.json({
      data: {
        totalOutstanding,
        overdueAmount,
        overdueCount: overdueLoans.length,
        dueThisMonthAmount,
        dueThisMonthCount: dueThisMonth.length,
        activeLoanCount: activeLoans.length,
        paidOffCount: loans.filter((l) => l.status === 'paid_off').length,
        totalPaidAll,
      },
    });
  } catch (error) {
    console.error('Error fetching loan summary:', error);
    res.status(500).json({ error: 'Failed to fetch loan summary' });
  }
};

export const createLoan = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create loans' });
    }

    const {
      title,
      lender,
      loanType,
      principalAmount,
      interestRate,
      termMonths,
      installmentAmount,
      paymentFrequency,
      startDate,
      nextDueDate,
      maturityDate,
      referenceNumber,
      accountNumber,
      collateral,
      contactPerson,
      contactPhone,
      note,
    } = req.body;

    const principal = Number(principalAmount);
    const parsedStart = normalizeLoanDate(startDate);
    const loan = new Loan({
      title: title?.trim(),
      lender: lender?.trim(),
      loanType: loanType || 'business',
      principalAmount: principal,
      interestRate: interestRate !== undefined ? Number(interestRate) : 0,
      termMonths: termMonths !== undefined ? Number(termMonths) : undefined,
      installmentAmount: Number(installmentAmount),
      paymentFrequency: paymentFrequency || 'monthly',
      startDate: parsedStart,
      maturityDate: maturityDate
        ? normalizeLoanDate(maturityDate)
        : computeMaturityDate(parsedStart, termMonths ? Number(termMonths) : undefined),
      nextDueDate: normalizeLoanDate(nextDueDate || startDate),
      totalPaid: 0,
      remainingBalance: principal,
      status: 'active',
      referenceNumber: referenceNumber ? referenceNumber.trim() : undefined,
      accountNumber: accountNumber ? accountNumber.trim() : undefined,
      collateral: collateral ? collateral.trim() : undefined,
      contactPerson: contactPerson ? contactPerson.trim() : undefined,
      contactPhone: contactPhone ? contactPhone.trim() : undefined,
      note: note ? note.trim() : undefined,
      payments: [],
      userId,
    });

    refreshLoanStatus(loan);
    await loan.save();
    res.status(201).json({ data: loan });
  } catch (error) {
    console.error('Error creating loan:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create loan' });
  }
};

export const updateLoan = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update loans' });
    }

    const loan = await Loan.findOne({ _id: req.params.id, userId });
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status === 'paid_off') {
      return res.status(400).json({ error: 'Cannot edit a fully paid loan' });
    }

    const {
      title,
      lender,
      loanType,
      principalAmount,
      interestRate,
      termMonths,
      installmentAmount,
      paymentFrequency,
      startDate,
      nextDueDate,
      maturityDate,
      referenceNumber,
      accountNumber,
      collateral,
      contactPerson,
      contactPhone,
      note,
    } = req.body;

    if (title !== undefined) loan.title = title.trim();
    if (lender !== undefined) loan.lender = lender.trim();
    if (loanType !== undefined) loan.loanType = loanType;
    if (principalAmount !== undefined) {
      const principal = Number(principalAmount);
      loan.principalAmount = principal;
      loan.remainingBalance = Math.max(0, principal - (loan.totalPaid || 0));
    }
    if (interestRate !== undefined) loan.interestRate = Number(interestRate);
    if (termMonths !== undefined) loan.termMonths = Number(termMonths);
    if (installmentAmount !== undefined) loan.installmentAmount = Number(installmentAmount);
    if (paymentFrequency !== undefined) loan.paymentFrequency = paymentFrequency;
    if (startDate !== undefined) loan.startDate = normalizeLoanDate(startDate);
    if (nextDueDate !== undefined) loan.nextDueDate = normalizeLoanDate(nextDueDate);
    if (maturityDate !== undefined) loan.maturityDate = normalizeLoanDate(maturityDate);
    if (referenceNumber !== undefined) loan.referenceNumber = referenceNumber ? referenceNumber.trim() : undefined;
    if (accountNumber !== undefined) loan.accountNumber = accountNumber ? accountNumber.trim() : undefined;
    if (collateral !== undefined) loan.collateral = collateral ? collateral.trim() : undefined;
    if (contactPerson !== undefined) loan.contactPerson = contactPerson ? contactPerson.trim() : undefined;
    if (contactPhone !== undefined) loan.contactPhone = contactPhone ? contactPhone.trim() : undefined;
    if (note !== undefined) loan.note = note ? note.trim() : undefined;

    if (!loan.maturityDate && loan.termMonths) {
      loan.maturityDate = computeMaturityDate(loan.startDate, loan.termMonths);
    }

    refreshLoanStatus(loan);
    await loan.save();
    res.json({ data: loan });
  } catch (error) {
    console.error('Error updating loan:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update loan' });
  }
};

export const recordLoanPayment = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot record loan payments' });
    }

    const loan = await Loan.findOne({ _id: req.params.id, userId });
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status === 'paid_off') {
      return res.status(400).json({ error: 'Loan is already fully paid' });
    }

    const {
      amount,
      paymentDate,
      principalPortion,
      interestPortion,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
      accountId,
    } = req.body;

    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: 'Valid payment amount is required' });
    }

    const expenseNote = [
      `Lender: ${loan.lender}`,
      loan.referenceNumber ? `Ref: ${loan.referenceNumber}` : null,
      note || null,
    ]
      .filter(Boolean)
      .join(' — ');

    const expense = new Expense({
      title: `Loan payment: ${loan.title}`,
      amount: paymentAmount,
      category: 'loan',
      date: normalizeLoanDate(paymentDate),
      note: expenseNote || 'Loan payment',
      paymentMethod: paymentMethod || 'transfer',
      bankAccountName: bankAccountName ? String(bankAccountName).trim() : undefined,
      bankAccountNumber: bankAccountNumber ? String(bankAccountNumber).trim() : undefined,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      accountId: accountId || undefined,
      userId,
    });

    await expense.save();

    const payment = {
      amount: paymentAmount,
      paymentDate: normalizeLoanDate(paymentDate),
      principalPortion: principalPortion !== undefined ? Number(principalPortion) : paymentAmount,
      interestPortion: interestPortion !== undefined ? Number(interestPortion) : 0,
      note: note ? note.trim() : undefined,
      paymentMethod: paymentMethod || 'transfer',
      bankAccountName: bankAccountName ? String(bankAccountName).trim() : undefined,
      bankAccountNumber: bankAccountNumber ? String(bankAccountNumber).trim() : undefined,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      expenseId: expense._id,
    };

    loan.payments.push(payment);
    loan.totalPaid = (loan.totalPaid || 0) + paymentAmount;
    loan.remainingBalance = Math.max(0, (loan.remainingBalance || loan.principalAmount) - paymentAmount);

    if (loan.remainingBalance > 0) {
      loan.nextDueDate = advanceDueDate(loan.nextDueDate, loan.paymentFrequency);
    }

    refreshLoanStatus(loan);
    await loan.save();

    res.json({ data: { loan, expense, payment: loan.payments[loan.payments.length - 1] } });
  } catch (error) {
    console.error('Error recording loan payment:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to record loan payment' });
  }
};

export const deleteLoan = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete loans' });
    }

    const loan = await Loan.findOneAndDelete({
      _id: req.params.id,
      userId,
      totalPaid: { $lte: 0 },
    });

    if (!loan) {
      const exists = await Loan.findOne({ _id: req.params.id, userId });
      if (exists) {
        return res.status(400).json({ error: 'Cannot delete a loan that has payments recorded' });
      }
      return res.status(404).json({ error: 'Loan not found' });
    }

    res.json({ message: 'Loan deleted successfully', data: loan });
  } catch (error) {
    console.error('Error deleting loan:', error);
    res.status(500).json({ error: 'Failed to delete loan' });
  }
};
