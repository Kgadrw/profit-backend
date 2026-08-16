import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { emitToUser } from './websocket.js';
import { sendEmail, renderEmailTemplate } from './emailService.js';
import { financePathForEntity } from './approvalWorkflow.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function entityLabel(entityType) {
  switch (entityType) {
    case 'expense':
      return 'expense';
    case 'bill':
      return 'bill';
    case 'payroll':
      return 'payroll';
    default:
      return 'submission';
  }
}

/**
 * Notify the original submitter that an approver requested changes.
 */
export async function notifySubmitterOfChangesRequested(record, {
  entityType,
  actorUserId,
  note,
} = {}) {
  try {
    const submitterId = record?.submittedByUserId;
    if (!submitterId) return;

    const reviewer = record.approvedByName || 'A reviewer';
    const titleText =
      entityType === 'payroll'
        ? `${record.employeeName || 'Payroll'} — ${record.period || ''}`.trim()
        : record.title || entityLabel(entityType);
    const route = financePathForEntity(entityType);
    const noteText = note || record.rejectionNote || '';
    const title = 'Changes requested';
    const body = `${reviewer} requested changes on your ${entityLabel(entityType)} "${titleText}".${
      noteText ? ` Note: ${String(noteText).slice(0, 180)}` : ''
    }`;

    const notification = await Notification.create({
      userId: submitterId,
      sentBy: actorUserId ? String(actorUserId) : 'system',
      type: 'approval_change_request',
      title,
      body,
      icon: '/logo.png',
      data: {
        entityType,
        recordId: String(record._id),
        workspaceId: record.workspaceId ? String(record.workspaceId) : null,
        route,
        status: 'changes_requested',
        note: noteText || null,
      },
      read: false,
    });

    emitToUser(String(submitterId), 'notification:created', notification.toObject());

    const user = await User.findById(submitterId).select('name email').lean();
    if (!user?.email) return;

    await sendEmail({
      to: user.email,
      subject: title,
      text: `${body}\n\nOpen Trippo to edit and resubmit.\n`,
      html: renderEmailTemplate({
        eyebrow: 'APPROVAL UPDATE',
        title: 'Changes requested',
        greeting: `Hello${user.name ? ` ${escapeHtml(user.name)}` : ''},`,
        paragraphs: [
          `${escapeHtml(reviewer)} requested changes on your <strong>${escapeHtml(entityLabel(entityType))}</strong> <strong>${escapeHtml(titleText)}</strong>.`,
          noteText ? `<strong>Note:</strong> ${escapeHtml(String(noteText).slice(0, 500))}` : '',
          'Open Trippo, edit the item, and resubmit it for approval.',
        ],
        closing: 'Regards,',
      }),
    });
  } catch (error) {
    console.error('Failed to notify submitter of requested changes:', error);
  }
}
