/** Shared approval workflow helpers for workspace finance records. */

export const APPROVAL_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'changes_requested',
];

export function isWorkspaceApprovalEnabled(req) {
  return req.dataScope?.mode === 'workspace';
}

export function canApproveRecords(req) {
  if (!isWorkspaceApprovalEnabled(req)) return true;
  const role = req.dataScope?.role;
  return role === 'owner' || role === 'admin';
}

export function getInitialApprovalStatus(req) {
  if (!isWorkspaceApprovalEnabled(req)) return 'approved';
  return canApproveRecords(req) ? 'approved' : 'pending_approval';
}

export function assertCanApprove(req) {
  if (!canApproveRecords(req)) {
    const error = new Error('Only workspace owners and admins can approve records');
    error.statusCode = 403;
    throw error;
  }
}

export function buildSubmissionFields(req, status) {
  if (status !== 'pending_approval') return {};
  const user = req.user;
  if (!user?._id) return {};
  return {
    submittedByUserId: user._id,
    submittedByName: user.name || 'User',
    approvedByUserId: undefined,
    approvedByName: undefined,
    approvedAt: undefined,
    rejectionNote: undefined,
  };
}

export function buildApprovalFields(req) {
  const user = req.user;
  return {
    approvalStatus: 'approved',
    approvedByUserId: user?._id,
    approvedByName: user?.name || 'User',
    approvedAt: new Date(),
    rejectionNote: undefined,
  };
}

export function buildRejectionFields(req, rejectionNote) {
  const user = req.user;
  return {
    approvalStatus: 'rejected',
    approvedByUserId: user?._id,
    approvedByName: user?.name || 'User',
    approvedAt: new Date(),
    rejectionNote: rejectionNote ? String(rejectionNote).trim().slice(0, 500) : undefined,
  };
}

export function buildChangesRequestedFields(req, changeNote) {
  const user = req.user;
  const note = changeNote ? String(changeNote).trim().slice(0, 500) : '';
  if (!note) {
    const error = new Error('A note is required when requesting changes');
    error.statusCode = 400;
    throw error;
  }
  return {
    approvalStatus: 'changes_requested',
    approvedByUserId: user?._id,
    approvedByName: user?.name || 'User',
    approvedAt: new Date(),
    rejectionNote: note,
  };
}

export function isRecordApproved(record) {
  const status = record?.approvalStatus;
  return !status || status === 'approved';
}

export function assertRecordApproved(record, actionLabel = 'perform this action') {
  if (!isRecordApproved(record)) {
    const error = new Error(`Record must be approved before you can ${actionLabel}`);
    error.statusCode = 400;
    throw error;
  }
}

export function isEditableApprovalStatus(status) {
  return status === 'rejected' || status === 'changes_requested' || status === 'draft' || !status || status === 'approved';
}

export function financePathForEntity(entityType) {
  switch (entityType) {
    case 'expense':
      return '/finance/expenditure';
    case 'bill':
      return '/finance/bills';
    case 'payroll':
      return '/finance/payroll';
    default:
      return '/approvals';
  }
}
