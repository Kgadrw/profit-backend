import WorkspaceMember from '../models/WorkspaceMember.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { emitToUser } from './websocket.js';
import { sendEmail, renderEmailTemplate } from './emailService.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLeaveRange(startDate, endDate) {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  const fmt = (d) =>
    d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';
  if (start && end && start.toDateString() === end.toDateString()) {
    return fmt(start);
  }
  return `${fmt(start)} → ${fmt(end)}`;
}

async function getLeaveReviewerUserIds(workspaceId, excludeUserId) {
  if (!workspaceId) return [];

  const members = await WorkspaceMember.find({ workspaceId })
    .select('userId role permissions')
    .lean();

  const reviewerIds = [];
  for (const member of members) {
    const userId = member?.userId ? String(member.userId) : '';
    if (!userId) continue;
    if (excludeUserId && userId === String(excludeUserId)) continue;

    const role = member.role;
    const permissions = Array.isArray(member.permissions) ? member.permissions : [];
    if (role === 'owner' || role === 'admin' || permissions.includes('hr')) {
      reviewerIds.push(userId);
    }
  }

  return [...new Set(reviewerIds)];
}

/**
 * Notify workspace owners/admins/HR that a leave request needs review.
 * Creates in-app notifications + email.
 */
export async function notifyLeaveReviewersOfNewRequest(leave, { workspaceId, actorUserId } = {}) {
  try {
    if (!leave || leave.status !== 'pending' || !workspaceId) return;

    const reviewerIds = await getLeaveReviewerUserIds(workspaceId, actorUserId);
    if (!reviewerIds.length) return;

    const reviewers = await User.find({ _id: { $in: reviewerIds } })
      .select('name email')
      .lean();

    const requesterName = leave.requesterName || 'A teammate';
    const leaveType = leave.leaveType || 'leave';
    const range = formatLeaveRange(leave.startDate, leave.endDate);
    const title = 'New leave request';
    const body = `${requesterName} requested ${leaveType} leave (${range}).`;
    const route = '/team/leave';
    const leaveId = String(leave._id);

    await Promise.all(
      reviewers.map(async (reviewer) => {
        const notification = await Notification.create({
          userId: reviewer._id,
          sentBy: actorUserId ? String(actorUserId) : 'system',
          type: 'leave_request',
          title,
          body,
          icon: '/logo.png',
          data: {
            leaveRequestId: leaveId,
            workspaceId: String(workspaceId),
            route,
            leaveType,
            startDate: leave.startDate,
            endDate: leave.endDate,
            requesterUserId: leave.requesterUserId ? String(leave.requesterUserId) : null,
          },
          read: false,
        });

        emitToUser(String(reviewer._id), 'notification:created', notification.toObject());

        if (!reviewer.email) return;

        const text = `${body}\n\nOpen Trippo → Team → Leave to approve or reject.\n`;
        const html = renderEmailTemplate({
          eyebrow: 'LEAVE REQUEST',
          title: 'Review requested',
          greeting: `Hello${reviewer.name ? ` ${escapeHtml(reviewer.name)}` : ''},`,
          paragraphs: [
            `<strong>${escapeHtml(requesterName)}</strong> submitted a leave request that needs your review.`,
            `<ul style="margin:0;padding-left:20px;line-height:1.7;"><li><strong>Type:</strong> ${escapeHtml(leaveType)}</li><li><strong>Dates:</strong> ${escapeHtml(range)}</li>${leave.reason ? `<li><strong>Reason:</strong> ${escapeHtml(String(leave.reason).slice(0, 300))}</li>` : ''}</ul>`,
            'Open <strong>HR → Leave</strong> in Trippo to approve or reject the request.',
          ],
          closing: 'Regards,',
        });

        try {
          await sendEmail({
            to: reviewer.email,
            subject: `Leave request from ${requesterName}`,
            text,
            html,
          });
        } catch (emailError) {
          console.error('Failed to email leave reviewer:', reviewer.email, emailError?.message || emailError);
        }
      }),
    );
  } catch (error) {
    console.error('Failed to notify leave reviewers:', error);
  }
}

/**
 * Notify the requester when their leave is approved or rejected.
 */
export async function notifyLeaveRequesterOfDecision(leave, { actorUserId, decision } = {}) {
  try {
    if (!leave?.requesterUserId) return;
    const status = decision || leave.status;
    if (status !== 'approved' && status !== 'rejected' && status !== 'changes_requested') return;

    const title =
      status === 'approved'
        ? 'Leave approved'
        : status === 'changes_requested'
          ? 'Leave changes requested'
          : 'Leave rejected';
    const range = formatLeaveRange(leave.startDate, leave.endDate);
    const reviewer = leave.reviewedByName || 'A manager';
    const body =
      status === 'approved'
        ? `${reviewer} approved your ${leave.leaveType || 'leave'} request (${range}).`
        : status === 'changes_requested'
          ? `${reviewer} requested changes on your ${leave.leaveType || 'leave'} request (${range}).`
          : `${reviewer} rejected your ${leave.leaveType || 'leave'} request (${range}).`;

    const notification = await Notification.create({
      userId: leave.requesterUserId,
      sentBy: actorUserId ? String(actorUserId) : 'system',
      type: 'leave_request',
      title,
      body,
      icon: '/logo.png',
      data: {
        leaveRequestId: String(leave._id),
        workspaceId: leave.workspaceId ? String(leave.workspaceId) : null,
        route: '/hr/leave',
        status,
      },
      read: false,
    });

    emitToUser(String(leave.requesterUserId), 'notification:created', notification.toObject());

    const user = await User.findById(leave.requesterUserId).select('name email').lean();
    if (!user?.email) return;

    await sendEmail({
      to: user.email,
      subject: title,
      text: `${body}\n\nOpen Trippo → HR → Leave for details.\n`,
      html: renderEmailTemplate({
        eyebrow: 'LEAVE REQUEST',
        title,
        greeting: `Hello${user.name ? ` ${escapeHtml(user.name)}` : ''},`,
        paragraphs: [
          escapeHtml(body),
          (status === 'rejected' || status === 'changes_requested') && leave.rejectionNote
            ? `<strong>Note:</strong> ${escapeHtml(String(leave.rejectionNote).slice(0, 500))}`
            : '',
          `Open <strong>HR → Leave</strong> in Trippo to ${
            status === 'changes_requested' ? 'edit and resubmit' : 'view details'
          }.`,
        ],
        closing: 'Regards,',
      }),
    });
  } catch (error) {
    console.error('Failed to notify leave requester:', error);
  }
}

