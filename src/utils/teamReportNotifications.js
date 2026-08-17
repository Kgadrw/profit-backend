import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { emitToUser } from './websocket.js';

export async function notifyReportReviewersOfSubmission(report, { workspaceId, actorUserId } = {}) {
  try {
    if (!report || report.status !== 'submitted' || !workspaceId) return;

    const reviewerIds = [
      ...new Set(
        (report.reportTo || [])
          .map((recipient) => (recipient?.userId ? String(recipient.userId) : ''))
          .filter((userId) => userId && userId !== String(actorUserId)),
      ),
    ];
    if (!reviewerIds.length) return;

    const reviewers = await User.find({ _id: { $in: reviewerIds } })
      .select('name')
      .lean();

    const submitterName = report.submitterName || 'A teammate';
    const title = 'Report review required';
    const body = `${submitterName} submitted “${report.title || 'a report'}” for your review.`;
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
            route: '/approvals',
            kind: 'team_report_approval',
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
          : decision === 'changes_requested'
            ? 'sent back with change requests'
            : 'updated';

    const title = 'Report update';
    const body = `Your report “${report.title || 'Untitled'}” was ${label}.`;
    const notification = await Notification.create({
      userId: report.submitterUserId,
      sentBy: actorUserId ? String(actorUserId) : 'system',
      type: 'general',
      title,
      body,
      icon: '/logo.png',
      data: {
        reportId: String(report._id),
        workspaceId: report.workspaceId ? String(report.workspaceId) : undefined,
        route: '/reports',
        kind: 'team_report',
        decision,
      },
    });
    emitToUser(submitterId, 'notification', notification);
  } catch (error) {
    console.error('Failed to notify report submitter:', error);
  }
}
