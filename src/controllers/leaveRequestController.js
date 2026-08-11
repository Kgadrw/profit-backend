import LeaveRequest from '../models/LeaveRequest.js';
import TeamMember from '../models/TeamMember.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { isWorkspaceApprovalEnabled } from '../utils/approvalWorkflow.js';
import { canReviewLeaveRequests } from '../constants/workspacePermissions.js';

const normalizeLeaveDate = (value) => {
  if (!value) return undefined;
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

function computeDayCount(startDate, endDate) {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(diff / (24 * 60 * 60 * 1000)) + 1);
}

function canReviewLeave(req) {
  if (!isWorkspaceApprovalEnabled(req)) return true;
  return canReviewLeaveRequests(req.dataScope?.role, req.dataScope?.permissions);
}

function getInitialLeaveStatus(req) {
  if (!isWorkspaceApprovalEnabled(req)) return 'approved';
  return canReviewLeave(req) ? 'approved' : 'pending';
}

function buildLeaveListQuery(req, extra = {}) {
  const query = buildListQuery(req, {});
  if (isWorkspaceApprovalEnabled(req) && !canReviewLeave(req)) {
    const userId = req.user._id;
    // Own requests + public decisions (approved/rejected) from teammates
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { requesterUserId: userId },
          {
            isPublic: true,
            status: { $in: ['approved', 'rejected'] },
          },
        ],
      },
    ];
  }
  return { ...query, ...extra };
}

function formatLeaveRequest(record) {
  const plain = record.toObject ? record.toObject() : record;
  return {
    ...plain,
    id: String(plain._id),
    dayCount: computeDayCount(plain.startDate, plain.endDate),
    isPublic: Boolean(plain.isPublic),
  };
}

async function findLeaveRequest(req, id) {
  // Reviewers can act on any leave; others only their own (for cancel/delete).
  const base = canReviewLeave(req)
    ? buildListQuery(req, { _id: id })
    : buildListQuery(req, { _id: id, requesterUserId: req.user._id });
  const leave = await LeaveRequest.findOne(base);
  if (!leave) {
    const error = new Error('Leave request not found');
    error.statusCode = 404;
    throw error;
  }
  return leave;
}

export const getLeaveRequests = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const { status } = req.query;
    const query = buildLeaveListQuery(req);

    if (['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
      query.status = status;
    }

    const leaves = await LeaveRequest.find(query).sort({ createdAt: -1, startDate: -1 });
    res.json({ data: leaves.map(formatLeaveRequest) });
  } catch (error) {
    console.error('Error fetching leave requests:', error);
    handleScopeError(res, error);
  }
};

export const getLeaveSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const pendingQuery = buildLeaveListQuery(req, { status: 'pending' });
    const pendingCount = await LeaveRequest.countDocuments(pendingQuery);

    const userId = req.user?._id;
    let myPendingCount = 0;
    if (userId) {
      myPendingCount = await LeaveRequest.countDocuments(
        buildListQuery(req, { requesterUserId: userId, status: 'pending' }),
      );
    }

    res.json({
      data: {
        pendingCount,
        myPendingCount,
        canReview: canReviewLeave(req),
      },
    });
  } catch (error) {
    console.error('Error fetching leave summary:', error);
    handleScopeError(res, error);
  }
};

export const createLeaveRequest = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const userId = req.user?._id;
    if (!userId || userId === 'admin') {
      return res.status(403).json({ error: 'Authentication required' });
    }

    const { teamMemberId, leaveType, startDate, endDate, reason, isPublic } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start and end dates are required' });
    }

    const parsedStart = normalizeLeaveDate(startDate);
    const parsedEnd = normalizeLeaveDate(endDate);
    if (parsedEnd < parsedStart) {
      return res.status(400).json({ error: 'End date must be on or after start date' });
    }

    let resolvedTeamMemberId;
    if (teamMemberId) {
      const member = await TeamMember.findOne(buildListQuery(req, { _id: teamMemberId }));
      if (member) resolvedTeamMemberId = member._id;
    }

    const status = getInitialLeaveStatus(req);
    const now = new Date();
    const reviewerFields =
      status === 'approved'
        ? {
            reviewedByUserId: userId,
            reviewedByName: req.user.name || 'User',
            reviewedAt: now,
          }
        : {};

    const leave = new LeaveRequest({
      teamMemberId: resolvedTeamMemberId,
      requesterUserId: userId,
      requesterName: req.user.name || 'User',
      leaveType: leaveType || 'annual',
      startDate: parsedStart,
      endDate: parsedEnd,
      reason: reason ? String(reason).trim() : undefined,
      isPublic: Boolean(isPublic),
      status,
      ...reviewerFields,
      ...buildCreateScope(req),
    });

    await leave.save();
    res.status(201).json({ data: formatLeaveRequest(leave) });
  } catch (error) {
    console.error('Error creating leave request:', error);
    handleScopeError(res, error);
  }
};

export const approveLeaveRequest = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    if (!canReviewLeave(req)) {
      return res.status(403).json({ error: 'Only workspace admins and HR can approve leave' });
    }

    const leave = await findLeaveRequest(req, req.params.id);
    if (leave.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending leave requests can be approved' });
    }

    leave.status = 'approved';
    leave.reviewedByUserId = req.user._id;
    leave.reviewedByName = req.user.name || 'User';
    leave.reviewedAt = new Date();
    leave.rejectionNote = undefined;
    await leave.save();

    res.json({ data: formatLeaveRequest(leave) });
  } catch (error) {
    console.error('Error approving leave request:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const rejectLeaveRequest = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    if (!canReviewLeave(req)) {
      return res.status(403).json({ error: 'Only workspace admins and HR can reject leave' });
    }

    const leave = await findLeaveRequest(req, req.params.id);
    if (leave.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending leave requests can be rejected' });
    }

    const { rejectionNote } = req.body || {};
    leave.status = 'rejected';
    leave.reviewedByUserId = req.user._id;
    leave.reviewedByName = req.user.name || 'User';
    leave.reviewedAt = new Date();
    leave.rejectionNote = rejectionNote ? String(rejectionNote).trim().slice(0, 500) : undefined;
    await leave.save();

    res.json({ data: formatLeaveRequest(leave) });
  } catch (error) {
    console.error('Error rejecting leave request:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const cancelLeaveRequest = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const leave = await findLeaveRequest(req, req.params.id);

    if (leave.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending leave requests can be cancelled' });
    }

    const userId = String(req.user._id);
    const isOwner = String(leave.requesterUserId) === userId;
    if (!isOwner && !canReviewLeave(req)) {
      return res.status(403).json({ error: 'You can only cancel your own leave requests' });
    }

    leave.status = 'cancelled';
    await leave.save();

    res.json({ data: formatLeaveRequest(leave) });
  } catch (error) {
    console.error('Error cancelling leave request:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const deleteLeaveRequest = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const leave = await findLeaveRequest(req, req.params.id);

    if (leave.status === 'approved') {
      return res.status(400).json({ error: 'Approved leave cannot be deleted' });
    }

    const userId = String(req.user._id);
    const isOwner = String(leave.requesterUserId) === userId;
    if (!isOwner && !canReviewLeave(req)) {
      return res.status(403).json({ error: 'Not allowed to delete this leave request' });
    }

    await LeaveRequest.deleteOne({ _id: leave._id });
    res.json({ message: 'Leave request deleted' });
  } catch (error) {
    console.error('Error deleting leave request:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};
