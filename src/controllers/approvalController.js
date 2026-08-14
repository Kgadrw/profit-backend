import Expense from '../models/Expense.js';
import Bill from '../models/Bill.js';
import Payroll from '../models/Payroll.js';
import { buildListQuery, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import {
  assertCanApprove,
  buildApprovalFields,
  buildChangesRequestedFields,
  buildRejectionFields,
  buildSubmissionFields,
  isWorkspaceApprovalEnabled,
} from '../utils/approvalWorkflow.js';
import { notifySubmitterOfChangesRequested } from '../utils/approvalNotifications.js';

const ENTITY_MODELS = {
  expense: Expense,
  bill: Bill,
  payroll: Payroll,
};

function formatApprovalItem(entityType, record) {
  const plain = record.toObject ? record.toObject() : record;
  const base = {
    entityType,
    id: String(plain._id),
    title:
      entityType === 'payroll'
        ? `${plain.employeeName} — ${plain.period}`
        : plain.title,
    amount: plain.amount,
    date: plain.date || plain.dueDate || plain.paymentDate,
    approvalStatus: plain.approvalStatus || 'approved',
    submittedByName: plain.submittedByName,
    submittedByUserId: plain.submittedByUserId ? String(plain.submittedByUserId) : undefined,
    submittedAt: plain.createdAt,
    rejectionNote: plain.rejectionNote,
    category: plain.category,
    status: plain.status,
  };

  if (entityType === 'bill') {
    base.vendor = plain.vendor;
    base.dueDate = plain.dueDate;
  }
  if (entityType === 'payroll') {
    base.employeeName = plain.employeeName;
    base.period = plain.period;
    base.paymentDate = plain.paymentDate;
  }

  return base;
}

async function findScopedRecord(req, entityType, id) {
  const Model = ENTITY_MODELS[entityType];
  if (!Model) {
    const error = new Error('Invalid entity type');
    error.statusCode = 400;
    throw error;
  }
  const record = await Model.findOne(buildListQuery(req, { _id: id }));
  if (!record) {
    const error = new Error('Record not found');
    error.statusCode = 404;
    throw error;
  }
  return record;
}

export const getApprovalQueue = async (req, res) => {
  try {
    assertPageAccess(req, 'approvals');
    const { status = 'pending_approval' } = req.query;
    const query = buildListQuery(req);

    if (status && status !== 'all') {
      query.approvalStatus = status;
    }

    const [expenses, bills, payrolls] = await Promise.all([
      Expense.find(query).sort({ createdAt: -1 }).limit(200),
      Bill.find(query).sort({ createdAt: -1 }).limit(200),
      Payroll.find(query).sort({ createdAt: -1 }).limit(200),
    ]);

    const items = [
      ...expenses.map((r) => formatApprovalItem('expense', r)),
      ...bills.map((r) => formatApprovalItem('bill', r)),
      ...payrolls.map((r) => formatApprovalItem('payroll', r)),
    ].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

    res.json({ data: items });
  } catch (error) {
    console.error('Error fetching approval queue:', error);
    handleScopeError(res, error);
  }
};

export const getApprovalSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'approvals');
    const query = buildListQuery(req, { approvalStatus: 'pending_approval' });

    const [expenseCount, billCount, payrollCount] = await Promise.all([
      Expense.countDocuments(query),
      Bill.countDocuments(query),
      Payroll.countDocuments(query),
    ]);

    res.json({
      data: {
        pendingCount: expenseCount + billCount + payrollCount,
        expenseCount,
        billCount,
        payrollCount,
      },
    });
  } catch (error) {
    console.error('Error fetching approval summary:', error);
    handleScopeError(res, error);
  }
};

export const approveRecord = async (req, res) => {
  try {
    assertPageAccess(req, 'approvals');
    assertCanApprove(req);

    const { entityType, id } = req.params;
    const record = await findScopedRecord(req, entityType, id);

    if (record.approvalStatus !== 'pending_approval') {
      return res.status(400).json({ error: 'Only pending records can be approved' });
    }

    Object.assign(record, buildApprovalFields(req));
    await record.save();

    res.json({ data: formatApprovalItem(entityType, record) });
  } catch (error) {
    console.error('Error approving record:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const rejectRecord = async (req, res) => {
  try {
    assertPageAccess(req, 'approvals');
    assertCanApprove(req);

    const { entityType, id } = req.params;
    const { rejectionNote } = req.body;
    const record = await findScopedRecord(req, entityType, id);

    if (record.approvalStatus !== 'pending_approval') {
      return res.status(400).json({ error: 'Only pending records can be rejected' });
    }

    Object.assign(record, buildRejectionFields(req, rejectionNote));
    await record.save();

    res.json({ data: formatApprovalItem(entityType, record) });
  } catch (error) {
    console.error('Error rejecting record:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const requestChangesRecord = async (req, res) => {
  try {
    assertPageAccess(req, 'approvals');
    assertCanApprove(req);

    const { entityType, id } = req.params;
    const { note, changeNote, rejectionNote } = req.body || {};
    const record = await findScopedRecord(req, entityType, id);

    if (record.approvalStatus !== 'pending_approval') {
      return res.status(400).json({ error: 'Only pending records can receive change requests' });
    }

    Object.assign(record, buildChangesRequestedFields(req, note || changeNote || rejectionNote));
    await record.save();

    void notifySubmitterOfChangesRequested(record, {
      entityType,
      actorUserId: req.user?._id,
      note: record.rejectionNote,
    });

    res.json({ data: formatApprovalItem(entityType, record) });
  } catch (error) {
    console.error('Error requesting changes on record:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const resubmitRecord = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    if (!isWorkspaceApprovalEnabled(req)) {
      return res.status(400).json({ error: 'Approval workflow is only used in workspaces' });
    }

    const { entityType, id } = req.params;
    const record = await findScopedRecord(req, entityType, id);

    if (!['rejected', 'draft', 'changes_requested'].includes(record.approvalStatus)) {
      return res.status(400).json({
        error: 'Only rejected, draft, or changes-requested records can be resubmitted',
      });
    }

    const submitterId = record.submittedByUserId ? String(record.submittedByUserId) : '';
    const actorId = req.user?._id ? String(req.user._id) : '';
    if (submitterId && actorId && submitterId !== actorId && !req.dataScope?.role?.match(/owner|admin/)) {
      // Allow owner/admin to resubmit on behalf; otherwise only the submitter.
      const role = req.dataScope?.role;
      if (role !== 'owner' && role !== 'admin') {
        return res.status(403).json({ error: 'Only the submitter can resubmit this record' });
      }
    }

    record.approvalStatus = 'pending_approval';
    Object.assign(record, buildSubmissionFields(req, 'pending_approval'));
    await record.save();

    res.json({ data: formatApprovalItem(entityType, record) });
  } catch (error) {
    console.error('Error resubmitting record:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};
