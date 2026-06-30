import Payroll from '../models/Payroll.js';
import TeamMember from '../models/TeamMember.js';
import mongoose from 'mongoose';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import {
  buildSubmissionFields,
  getInitialApprovalStatus,
  isWorkspaceApprovalEnabled,
} from '../utils/approvalWorkflow.js';

const normalizePayrollDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

async function resolvePayrollEmployee(req, { teamMemberId, employeeName }) {
  if (teamMemberId && mongoose.Types.ObjectId.isValid(teamMemberId)) {
    const member = await TeamMember.findOne(buildListQuery(req, { _id: teamMemberId }));
    if (member) {
      return {
        teamMemberId: member._id,
        employeeName: member.name,
      };
    }
  }

  return {
    teamMemberId: null,
    employeeName: employeeName?.trim(),
  };
}

export const getPayrolls = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { startDate, endDate, period } = req.query;
    const query = buildListQuery(req);

    if (period) query.period = period;

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.paymentDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.paymentDate.$lte = end;
      }
    }

    const payrolls = await Payroll.find(query).sort({ paymentDate: -1, createdAt: -1 });
    res.json({ data: payrolls });
  } catch (error) {
    console.error('Error fetching payrolls:', error);
    handleScopeError(res, error);
  }
};

export const getPayroll = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const payroll = await Payroll.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    res.json({ data: payroll });
  } catch (error) {
    console.error('Error fetching payroll:', error);
    handleScopeError(res, error);
  }
};

export const createPayroll = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');

    const {
      employeeName,
      teamMemberId,
      amount,
      period,
      paymentDate,
      status,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
      accountId,
    } = req.body;

    const approvalStatus = getInitialApprovalStatus(req);
    const resolvedEmployee = await resolvePayrollEmployee(req, { teamMemberId, employeeName });

    const payroll = new Payroll({
      employeeName: resolvedEmployee.employeeName,
      teamMemberId: resolvedEmployee.teamMemberId,
      amount: Number(amount),
      period: period?.trim(),
      paymentDate: normalizePayrollDate(paymentDate),
      status: status || 'paid',
      note: note ? note.trim() : undefined,
      paymentMethod: paymentMethod || 'transfer',
      bankAccountName: bankAccountName ? bankAccountName.trim() : undefined,
      bankAccountNumber: bankAccountNumber ? bankAccountNumber.trim() : undefined,
      accountId: accountId || undefined,
      receiptUrl: receiptUrl || undefined,
      receiptFileName: receiptFileName || undefined,
      approvalStatus,
      ...buildSubmissionFields(req, approvalStatus),
      ...buildCreateScope(req),
    });

    await payroll.save();
    res.status(201).json({ data: payroll });
  } catch (error) {
    console.error('Error creating payroll:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create payroll' });
  }
};

export const updatePayroll = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const payroll = await Payroll.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    if (isWorkspaceApprovalEnabled(req) && payroll.approvalStatus === 'pending_approval') {
      return res.status(400).json({ error: 'Pending payroll records cannot be edited. Wait for approval or delete and recreate.' });
    }

    const {
      employeeName,
      teamMemberId,
      amount,
      period,
      paymentDate,
      status,
      note,
      paymentMethod,
      bankAccountName,
      bankAccountNumber,
      receiptUrl,
      receiptFileName,
      accountId,
    } = req.body;

    if (employeeName !== undefined || teamMemberId !== undefined) {
      const resolvedEmployee = await resolvePayrollEmployee(req, {
        teamMemberId: teamMemberId ?? payroll.teamMemberId,
        employeeName: employeeName ?? payroll.employeeName,
      });
      payroll.employeeName = resolvedEmployee.employeeName;
      payroll.teamMemberId = resolvedEmployee.teamMemberId;
    }
    if (amount !== undefined) payroll.amount = Number(amount);
    if (period !== undefined) payroll.period = period?.trim();
    if (paymentDate !== undefined) payroll.paymentDate = normalizePayrollDate(paymentDate);
    if (status !== undefined) payroll.status = status;
    if (note !== undefined) payroll.note = note ? note.trim() : undefined;
    if (paymentMethod !== undefined) payroll.paymentMethod = paymentMethod;
    if (bankAccountName !== undefined) payroll.bankAccountName = bankAccountName ? bankAccountName.trim() : undefined;
    if (bankAccountNumber !== undefined) payroll.bankAccountNumber = bankAccountNumber ? bankAccountNumber.trim() : undefined;
    if (accountId !== undefined) payroll.accountId = accountId || undefined;
    if (receiptUrl !== undefined) payroll.receiptUrl = receiptUrl || undefined;
    if (receiptFileName !== undefined) payroll.receiptFileName = receiptFileName || undefined;

    if (isWorkspaceApprovalEnabled(req) && payroll.approvalStatus === 'rejected') {
      payroll.approvalStatus = 'pending_approval';
      Object.assign(payroll, buildSubmissionFields(req, 'pending_approval'));
    }

    await payroll.save();
    res.json({ data: payroll });
  } catch (error) {
    console.error('Error updating payroll:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update payroll' });
  }
};

export const deletePayroll = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const payroll = await Payroll.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    res.json({ message: 'Payroll deleted successfully', data: payroll });
  } catch (error) {
    console.error('Error deleting payroll:', error);
    handleScopeError(res, error);
  }
};
