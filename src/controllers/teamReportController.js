import TeamReport from '../models/TeamReport.js';
import TeamMember from '../models/TeamMember.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { isWorkspaceApprovalEnabled } from '../utils/approvalWorkflow.js';
import {
  notifyReportReviewersOfSubmission,
  notifyReportSubmitterOfDecision,
} from '../utils/teamReportNotifications.js';

const REPORT_TYPES = ['daily', 'weekly', 'monthly'];
const REPORT_STATUSES = ['submitted', 'reviewed', 'changes_requested', 'rejected'];

const normalizeDate = (value) => {
  if (!value) return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

function canReviewReports(req) {
  if (!isWorkspaceApprovalEnabled(req)) return true;
  const role = req.dataScope?.role;
  return role === 'owner' || role === 'admin';
}

function isAssignedReviewer(report, userId) {
  return (report?.reportTo || []).some(
    (recipient) => recipient?.userId && String(recipient.userId) === String(userId),
  );
}

function canReviewReport(req, report) {
  return canReviewReports(req) || isAssignedReviewer(report, req.user?._id);
}

function buildReportListQuery(req, extra = {}) {
  const query = buildListQuery(req, {});
  if (isWorkspaceApprovalEnabled(req) && !canReviewReports(req)) {
    query.$or = [
      { submitterUserId: req.user._id },
      { 'reportTo.userId': req.user._id },
    ];
  }
  return { ...query, ...extra };
}

function formatTeamReport(record) {
  const plain = record.toObject ? record.toObject() : record;
  return {
    ...plain,
    id: String(plain._id),
    blockers: plain.blockers || '',
    nextSteps: plain.nextSteps || '',
  };
}

async function findTeamReport(req, id) {
  const report = await TeamReport.findOne(buildListQuery(req, { _id: id }));
  if (!report) {
    const error = new Error('Team report not found');
    error.statusCode = 404;
    throw error;
  }
  const isSubmitter = String(report.submitterUserId) === String(req.user?._id);
  if (!isSubmitter && !canReviewReport(req, report)) {
    const error = new Error('Team report not found');
    error.statusCode = 404;
    throw error;
  }
  return report;
}

function getInitialStatus(req) {
  // Personal mode has no separate admin reviewer.
  if (!isWorkspaceApprovalEnabled(req)) return 'reviewed';
  return 'submitted';
}

function sanitizeText(value, max) {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

async function resolveReportRecipients(req, value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    const error = new Error('Report recipients must be a list');
    error.statusCode = 400;
    throw error;
  }

  const memberIds = [...new Set(value.map((id) => String(id || '')).filter(Boolean))].slice(0, 20);
  if (!memberIds.length) return [];
  const members = await TeamMember.find(
    buildListQuery(req, { _id: { $in: memberIds }, status: 'active' }),
  )
    .select('_id name linkedUserId')
    .lean();
  if (members.length !== memberIds.length) {
    const error = new Error('One or more report recipients are invalid');
    error.statusCode = 400;
    throw error;
  }
  return members.map((member) => ({
    memberId: member._id,
    userId: member.linkedUserId || null,
    name: member.name,
  }));
}

export const getTeamReports = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const { status, reportType, mine } = req.query;
    const query = buildReportListQuery(req);

    if (REPORT_STATUSES.includes(status)) {
      query.status = status;
    }
    if (REPORT_TYPES.includes(reportType)) {
      query.reportType = reportType;
    }
    if (mine === '1' || mine === 'true') {
      query.submitterUserId = req.user._id;
    }

    const reports = await TeamReport.find(query).sort({ createdAt: -1 });
    res.json({
      data: reports.map((report) => ({
        ...formatTeamReport(report),
        canReview: canReviewReport(req, report),
      })),
      meta: { canReview: canReviewReports(req) },
    });
  } catch (error) {
    console.error('Error fetching team reports:', error);
    handleScopeError(res, error);
  }
};

export const getTeamReportSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const submittedQuery = buildReportListQuery(req, { status: 'submitted' });
    const submittedCount = await TeamReport.countDocuments(submittedQuery);

    const userId = req.user?._id;
    let mySubmittedCount = 0;
    let myChangesCount = 0;
    if (userId) {
      mySubmittedCount = await TeamReport.countDocuments(
        buildListQuery(req, { submitterUserId: userId, status: 'submitted' }),
      );
      myChangesCount = await TeamReport.countDocuments(
        buildListQuery(req, { submitterUserId: userId, status: 'changes_requested' }),
      );
    }

    res.json({
      data: {
        submittedCount,
        mySubmittedCount,
        myChangesCount,
        canReview: canReviewReports(req),
      },
    });
  } catch (error) {
    console.error('Error fetching team report summary:', error);
    handleScopeError(res, error);
  }
};

export const createTeamReport = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const userId = req.user?._id;
    if (!userId || userId === 'admin') {
      return res.status(403).json({ error: 'Authentication required' });
    }

    const {
      title,
      reportType,
      periodStart,
      periodEnd,
      accomplishments,
      blockers,
      nextSteps,
      attachmentUrl,
      attachmentName,
      reportTo,
    } = req.body || {};

    const cleanTitle = sanitizeText(title, 200);
    const cleanAccomplishments = sanitizeText(accomplishments, 5000);
    if (!cleanTitle) return res.status(400).json({ error: 'Title is required' });
    if (!cleanAccomplishments) {
      return res.status(400).json({ error: 'Accomplishments are required' });
    }

    const parsedStart = normalizeDate(periodStart);
    const parsedEnd = normalizeDate(periodEnd);
    if (!parsedStart || !parsedEnd) {
      return res.status(400).json({ error: 'Period start and end dates are required' });
    }
    if (parsedEnd < parsedStart) {
      return res.status(400).json({ error: 'Period end must be on or after period start' });
    }

    const type = REPORT_TYPES.includes(reportType) ? reportType : 'daily';
    const recipients = await resolveReportRecipients(req, reportTo || []);
    const status = getInitialStatus(req);
    const now = new Date();
    const reviewerFields =
      status === 'reviewed'
        ? {
            reviewedByUserId: userId,
            reviewedByName: req.user.name || 'User',
            reviewedAt: now,
          }
        : {};

    const report = new TeamReport({
      submitterUserId: userId,
      submitterName: req.user.name || 'User',
      title: cleanTitle,
      reportType: type,
      periodStart: parsedStart,
      periodEnd: parsedEnd,
      accomplishments: cleanAccomplishments,
      blockers: sanitizeText(blockers, 3000) || '',
      nextSteps: sanitizeText(nextSteps, 3000) || '',
      attachmentUrl: sanitizeText(attachmentUrl, 1000),
      attachmentName: sanitizeText(attachmentName, 255),
      reportTo: recipients,
      status,
      ...reviewerFields,
      ...buildCreateScope(req),
    });

    await report.save();

    if (status === 'submitted' && report.workspaceId) {
      void notifyReportReviewersOfSubmission(report, {
        workspaceId: report.workspaceId,
        actorUserId: userId,
      });
    }

    res.status(201).json({ data: formatTeamReport(report) });
  } catch (error) {
    console.error('Error creating team report:', error);
    handleScopeError(res, error);
  }
};

export const updateTeamReport = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const report = await findTeamReport(req, req.params.id);
    const userId = String(req.user._id);
    const isOwner = String(report.submitterUserId) === userId;

    if (!isOwner) {
      return res.status(403).json({ error: 'Only the submitter can edit this report' });
    }
    if (!['changes_requested', 'rejected', 'submitted'].includes(report.status)) {
      return res.status(400).json({ error: 'This report cannot be edited' });
    }
    if (report.status === 'submitted') {
      return res.status(400).json({
        error: 'Submitted reports cannot be edited until a reviewer requests changes.',
      });
    }

    const {
      title,
      reportType,
      periodStart,
      periodEnd,
      accomplishments,
      blockers,
      nextSteps,
      attachmentUrl,
      attachmentName,
      reportTo,
    } = req.body || {};

    if (title !== undefined) {
      const cleanTitle = sanitizeText(title, 200);
      if (!cleanTitle) return res.status(400).json({ error: 'Title is required' });
      report.title = cleanTitle;
    }
    if (accomplishments !== undefined) {
      const cleanAccomplishments = sanitizeText(accomplishments, 5000);
      if (!cleanAccomplishments) {
        return res.status(400).json({ error: 'Accomplishments are required' });
      }
      report.accomplishments = cleanAccomplishments;
    }
    if (reportType !== undefined && REPORT_TYPES.includes(reportType)) {
      report.reportType = reportType;
    }
    if (periodStart !== undefined || periodEnd !== undefined) {
      const parsedStart = normalizeDate(periodStart !== undefined ? periodStart : report.periodStart);
      const parsedEnd = normalizeDate(periodEnd !== undefined ? periodEnd : report.periodEnd);
      if (!parsedStart || !parsedEnd) {
        return res.status(400).json({ error: 'Period start and end dates are required' });
      }
      if (parsedEnd < parsedStart) {
        return res.status(400).json({ error: 'Period end must be on or after period start' });
      }
      report.periodStart = parsedStart;
      report.periodEnd = parsedEnd;
    }
    if (blockers !== undefined) report.blockers = sanitizeText(blockers, 3000) || '';
    if (nextSteps !== undefined) report.nextSteps = sanitizeText(nextSteps, 3000) || '';
    if (attachmentUrl !== undefined) report.attachmentUrl = sanitizeText(attachmentUrl, 1000);
    if (attachmentName !== undefined) report.attachmentName = sanitizeText(attachmentName, 255);
    if (reportTo !== undefined) report.reportTo = await resolveReportRecipients(req, reportTo);

    await report.save();
    res.json({ data: formatTeamReport(report) });
  } catch (error) {
    console.error('Error updating team report:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const reviewTeamReport = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const report = await findTeamReport(req, req.params.id);
    if (!canReviewReport(req, report)) {
      return res.status(403).json({ error: 'Only assigned recipients or workspace admins can review reports' });
    }
    if (report.status !== 'submitted') {
      return res.status(400).json({ error: 'Only submitted reports can be marked as reviewed' });
    }

    const { reviewNote } = req.body || {};
    report.status = 'reviewed';
    report.reviewedByUserId = req.user._id;
    report.reviewedByName = req.user.name || 'User';
    report.reviewedAt = new Date();
    report.reviewNote = sanitizeText(reviewNote, 1000);
    await report.save();

    void notifyReportSubmitterOfDecision(report, {
      actorUserId: req.user._id,
      decision: 'reviewed',
    });

    res.json({ data: formatTeamReport(report) });
  } catch (error) {
    console.error('Error reviewing team report:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const rejectTeamReport = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const report = await findTeamReport(req, req.params.id);
    if (!canReviewReport(req, report)) {
      return res.status(403).json({ error: 'Only assigned recipients or workspace admins can reject reports' });
    }
    if (report.status !== 'submitted') {
      return res.status(400).json({ error: 'Only submitted reports can be rejected' });
    }

    const { reviewNote } = req.body || {};
    report.status = 'rejected';
    report.reviewedByUserId = req.user._id;
    report.reviewedByName = req.user.name || 'User';
    report.reviewedAt = new Date();
    report.reviewNote = sanitizeText(reviewNote, 1000);
    await report.save();

    void notifyReportSubmitterOfDecision(report, {
      actorUserId: req.user._id,
      decision: 'rejected',
    });

    res.json({ data: formatTeamReport(report) });
  } catch (error) {
    console.error('Error rejecting team report:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const requestTeamReportChanges = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const report = await findTeamReport(req, req.params.id);
    if (!canReviewReport(req, report)) {
      return res.status(403).json({ error: 'Only assigned recipients or workspace admins can request changes' });
    }
    if (report.status !== 'submitted') {
      return res.status(400).json({ error: 'Only submitted reports can receive change requests' });
    }

    const { note, reviewNote } = req.body || {};
    const message = sanitizeText(note || reviewNote, 1000);
    if (!message) {
      return res.status(400).json({ error: 'A note is required when requesting changes' });
    }

    report.status = 'changes_requested';
    report.reviewedByUserId = req.user._id;
    report.reviewedByName = req.user.name || 'User';
    report.reviewedAt = new Date();
    report.reviewNote = message;
    await report.save();

    void notifyReportSubmitterOfDecision(report, {
      actorUserId: req.user._id,
      decision: 'changes_requested',
    });

    res.json({ data: formatTeamReport(report) });
  } catch (error) {
    console.error('Error requesting team report changes:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const resubmitTeamReport = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const report = await findTeamReport(req, req.params.id);
    const userId = String(req.user._id);
    if (String(report.submitterUserId) !== userId) {
      return res.status(403).json({ error: 'Only the submitter can resubmit this report' });
    }
    if (!['changes_requested', 'rejected'].includes(report.status)) {
      return res.status(400).json({ error: 'Only returned reports can be resubmitted' });
    }

    report.status = getInitialStatus(req) === 'reviewed' ? 'reviewed' : 'submitted';
    report.reviewedByUserId = undefined;
    report.reviewedByName = undefined;
    report.reviewedAt = undefined;
    report.reviewNote = undefined;

    if (report.status === 'reviewed') {
      report.reviewedByUserId = req.user._id;
      report.reviewedByName = req.user.name || 'User';
      report.reviewedAt = new Date();
    }

    await report.save();

    if (report.status === 'submitted' && report.workspaceId) {
      void notifyReportReviewersOfSubmission(report, {
        workspaceId: report.workspaceId,
        actorUserId: userId,
      });
    }

    res.json({ data: formatTeamReport(report) });
  } catch (error) {
    console.error('Error resubmitting team report:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const deleteTeamReport = async (req, res) => {
  try {
    assertPageAccess(req, 'reports');
    const report = await findTeamReport(req, req.params.id);
    const userId = String(req.user._id);
    const isOwner = String(report.submitterUserId) === userId;
    const isReviewer = canReviewReports(req);

    if (!isOwner && !isReviewer) {
      return res.status(403).json({ error: 'Not allowed to delete this report' });
    }
    if (isOwner && !isReviewer && !['changes_requested', 'rejected', 'submitted'].includes(report.status)) {
      return res.status(400).json({ error: 'Reviewed reports cannot be deleted by the submitter' });
    }

    await TeamReport.deleteOne({ _id: report._id });
    res.json({ data: { id: String(report._id) } });
  } catch (error) {
    console.error('Error deleting team report:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};
