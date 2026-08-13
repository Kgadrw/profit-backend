import WorkspaceMember from '../models/WorkspaceMember.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { emitToUser } from './websocket.js';
import { sendEmail } from './emailService.js';

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
        const html = `
          <p>Hello${reviewer.name ? ` ${reviewer.name}` : ''},</p>
          <p><strong>${requesterName}</strong> submitted a leave request that needs your review.</p>
          <ul>
            <li><strong>Type:</strong> ${leaveType}</li>
            <li><strong>Dates:</strong> ${range}</li>
            ${leave.reason ? `<li><strong>Reason:</strong> ${String(leave.reason).slice(0, 300)}</li>` : ''}
          </ul>
          <p>Please open <strong>Team → Leave</strong> in Trippo to approve or reject.</p>
        `;

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
    if (status !== 'approved' && status !== 'rejected') return;

    const title = status === 'approved' ? 'Leave approved' : 'Leave rejected';
    const range = formatLeaveRange(leave.startDate, leave.endDate);
    const reviewer = leave.reviewedByName || 'A manager';
    const body =
      status === 'approved'
        ? `${reviewer} approved your ${leave.leaveType || 'leave'} request (${range}).`
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
        route: '/team/leave',
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
      text: `${body}\n\nOpen Trippo → Team → Leave for details.\n`,
      html: `
        <p>Hello${user.name ? ` ${user.name}` : ''},</p>
        <p>${body}</p>
        ${
          status === 'rejected' && leave.rejectionNote
            ? `<p><strong>Note:</strong> ${String(leave.rejectionNote).slice(0, 500)}</p>`
            : ''
        }
        <p>Open <strong>Team → Leave</strong> in Trippo for details.</p>
      `,
    });
  } catch (error) {
    console.error('Failed to notify leave requester:', error);
  }
}
