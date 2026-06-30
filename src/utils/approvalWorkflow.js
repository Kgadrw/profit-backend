/** Shared approval workflow helpers for workspace finance records. */

export const APPROVAL_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected'];

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
