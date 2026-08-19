import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { emitToUser } from './websocket.js';
import { sendEmail, renderEmailTemplate, getFrontendBaseUrl } from './emailService.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatReportPeriod(report) {
  if (!report?.periodStart || !report?.periodEnd) return null;
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const start = new Date(report.periodStart).toLocaleDateString('en-US', options);
  const end = new Date(report.periodEnd).toLocaleDateString('en-US', options);
  return start === end ? start : `${start} – ${end}`;
}

function visibilityLabel(visibility) {
  return visibility === 'public'
    ? 'Public — visible to everyone on the team'
    : 'Private — visible only to the submitter and assigned reviewers';
}

function buildLoginAwarePlatformUrl(path) {
  const baseUrl = getFrontendBaseUrl().replace(/\/$/, '');
  const safePath =
    typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
      ? path
      : '/';
  return `${baseUrl}/login?redirect=${encodeURIComponent(safePath)}`;
}

function attachmentEmailLines(report) {
  const name = String(report.attachmentName || '').trim();
  const url = String(report.attachmentUrl || '').trim();
  if (!url && !name) return [];

  if (/^https?:\/\//i.test(url)) {
    const label = name || 'View attachment';
    return [
      `<strong>Attachment:</strong> <a href="${escapeHtml(url)}" style="color:#0f3d5e;font-weight:700;text-decoration:underline;">${escapeHtml(label)}</a>`,
    ];
  }

  if (name || url) {
    return [
      `<strong>Attachment:</strong> ${escapeHtml(name || 'Document')} — open the report in Trippo to view or download the file.`,
    ];
  }

  return [];
}

function buildReportSummaryHtml(report, submitterName) {
  const period = formatReportPeriod(report);
  const rows = [
    ['Report title', escapeHtml(report.title || 'Untitled report')],
    ['Submitted by', escapeHtml(submitterName || 'A teammate')],
    period ? ['Reporting period', escapeHtml(period)] : null,
    ['Visibility', escapeHtml(visibilityLabel(report.visibility))],
    [
      'Description',
      escapeHtml(report.accomplishments || '—').replace(/\n/g, '<br>'),
    ],
    ...attachmentEmailLines(report).map((line) => ['Document', line]),
  ].filter(Boolean);

  const bodyRows = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:10px 14px;border:1px solid #e5eaf0;background:#fafcfd;font-size:13px;font-weight:700;color:#475467;vertical-align:top;width:34%;">${label}</td>
        <td style="padding:10px 14px;border:1px solid #e5eaf0;font-size:14px;line-height:1.6;color:#243044;vertical-align:top;">${value}</td>
      </tr>`,
    )
    .join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 4px;border-collapse:collapse;">${bodyRows}</table>`;
}

function buildReviewerReportEmail({ reviewer, report, submitterName }) {
  const approvalsUrl = buildLoginAwarePlatformUrl('/approvals');
  const title = report.title || 'Team report';
  const greetingName = reviewer.name ? escapeHtml(reviewer.name.split(' ')[0]) : 'Colleague';

  const html = renderEmailTemplate({
    eyebrow: 'TEAM REPORT',
    title: 'A report has been submitted for your review',
    greeting: `Dear ${greetingName},`,
    paragraphs: [
      `<strong>${escapeHtml(submitterName)}</strong> has submitted a team report and selected you under <strong>Reporting to</strong>. Please review the submission at your earliest convenience.`,
      'Report details:',
      buildReportSummaryHtml(report, submitterName),
    ],
    actionUrl: approvalsUrl,
    actionText: 'Open report in Trippo',
    closing: 'Kind regards,',
    footerNote:
      'You received this email because you were assigned as a reviewer for this report. Sign in to Trippo to approve, request changes, or reject the submission.',
  });

  const period = formatReportPeriod(report);
  const attachmentLines = attachmentEmailLines(report).map((line) =>
    line.replace(/<[^>]+>/g, ''),
  );

  const text = [
    `Dear ${reviewer.name || 'Colleague'},`,
    '',
    `${submitterName} has submitted a team report and selected you under Reporting to.`,
    '',
    `Report title: ${title}`,
    `Submitted by: ${submitterName}`,
    period ? `Reporting period: ${period}` : '',
    `Visibility: ${visibilityLabel(report.visibility)}`,
    '',
    'Description:',
    report.accomplishments || '—',
    ...attachmentLines,
    '',
    `Review in Trippo: ${approvalsUrl}`,
    '',
    'Kind regards,',
    'Trippo',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject: `Report submitted for your review: ${title}`,
    html,
    text,
  };
}

async function emailReportReviewers(report, reviewers, submitterName) {
  const withEmail = reviewers.filter((reviewer) => reviewer?.email);
  if (!withEmail.length) return;

  await Promise.all(
    withEmail.map(async (reviewer) => {
      try {
        const { subject, html, text } = buildReviewerReportEmail({
          reviewer,
          report,
          submitterName,
        });
        await sendEmail({
          to: reviewer.email,
          subject,
          text,
          html,
          fromName: 'Trippo Reports',
        });
      } catch (error) {
        console.error(`Failed to email report reviewer ${reviewer._id}:`, error);
      }
    }),
  );
}

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
      .select('name email')
      .lean();

    const submitterName = report.submitterName || 'A teammate';
    const title = 'Report review required';
    const body = `${submitterName} submitted “${report.title || 'a report'}” for your review.`;
    const reportId = String(report._id);

    await Promise.all([
      Promise.all(
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
      ),
      emailReportReviewers(report, reviewers, submitterName),
    ]);
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
