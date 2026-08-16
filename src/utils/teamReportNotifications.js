import WorkspaceMember from '../models/WorkspaceMember.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { emitToUser } from './websocket.js';

async function getReportReviewerUserIds(workspaceId, excludeUserId) {
  if (!workspaceId) return [];

  const members = await WorkspaceMember.find({ workspaceId })
    .select('userId role')
    .lean();

  const reviewerIds = [];
  for (const member of members) {
    const userId = member?.userId ? String(member.userId) : '';
    if (!userId) continue;
    if (excludeUserId && userId === String(excludeUserId)) continue;
    if (member.role === 'owner' || member.role === 'admin') {
      reviewerIds.push(userId);
    }
  }

  return [...new Set(reviewerIds)];
}

export async function notifyReportReviewersOfSubmission(report, { workspaceId, actorUserId } = {}) {
  try {
    if (!report || report.status !== 'submitted' || !workspaceId) return;

    const adminReviewerIds = await getReportReviewerUserIds(workspaceId, actorUserId);
    const assignedReviewerIds = (report.reportTo || [])
      .map((recipient) => (recipient?.userId ? String(recipient.userId) : ''))
      .filter((userId) => userId && userId !== String(actorUserId));
    const reviewerIds = [...new Set([...adminReviewerIds, ...assignedReviewerIds])];
    if (!reviewerIds.length) return;

    const reviewers = await User.find({ _id: { $in: reviewerIds } })
      .select('name')
      .lean();

    const submitterName = report.submitterName || 'A teammate';
    const title = 'New team report';
    const body = `${submitterName} submitted “${report.title || 'a report'}”.`;
    const reportId = String(report._id);

    await Promise.all(
      reviewers.map(async (reviewer) => {
        const notification = await Notification.create({
          userId: reviewer._id,
          sentBy: actorUserId ? String(actorUserId) : 'system',
          type: 'general',
          title,
          body,
          icon: '/logo.png',
          data: {
            reportId,
            workspaceId: String(workspaceId),
            route: '/reports',
            kind: 'team_report',
          },
        });
        emitToUser(String(reviewer._id), 'notification', notification);
      }),
    );
  } catch (error) {
    console.error('Failed to notify report reviewers:', error);
  }
}

export async function notifyReportSubmitterOfDecision(report, { actorUserId, decision } = {}) {
  try {
    if (!report?.submitterUserId) return;
    const submitterId = String(report.submitterUserId);
    if (actorUserId && submitterId === String(actorUserId)) return;

    const label =
      decision === 'reviewed'
        ? 'reviewed'
        : decision === 'rejected'
          ? 'rejected'
          : 'needs changes';
    const title = `Report ${label}`;
    const body =
      decision === 'changes_requested' && report.reviewNote
        ? `Your report “${report.title}” needs changes: ${report.reviewNote}`
        : `Your report “${report.title}” was ${label}.`;

    const notification = await Notification.create({
      userId: report.submitterUserId,
      sentBy: actorUserId ? String(actorUserId) : 'system',
      type: 'general',
      title,
      body,
      icon: '/logo.png',
      data: {
        reportId: String(report._id),
        workspaceId: report.workspaceId ? String(report.workspaceId) : null,
        route: '/reports',
        kind: 'team_report',
        decision,
      },
      read: false,
    });
    emitToUser(submitterId, 'notification', notification);
  } catch (error) {
    console.error('Failed to notify report submitter:', error);
  }
}
