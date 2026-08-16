import { renderEmailTemplate, sendEmail } from '../src/utils/emailService.js';

const recipient = process.argv[2];
if (!recipient) {
  console.error('Usage: node scripts/send-email-template-previews.js recipient@example.com');
  process.exit(1);
}

const appUrl = 'https://bookfy.trippo.rw';
const standard = (title, paragraphs, options = {}) =>
  renderEmailTemplate({
    title,
    greeting: 'Hello Alex,',
    paragraphs,
    closing: options.closing || 'Best regards,',
    senderUser: { businessName: 'Trippo' },
    ...options,
  });

const previews = [
  {
    name: 'Account security / OTP',
    html: standard('Verify your email', [
      'Use the verification code below to finish setting up your account.',
      '<span style="display:block;padding:16px;border:2px solid #20a39e;border-radius:6px;background:#f3fbfa;text-align:center;font-family:monospace;font-size:30px;font-weight:700;letter-spacing:7px;color:#0f3d5e;">482 915</span>',
      '<span style="font-size:13px;color:#667085;">This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</span>',
    ], { eyebrow: 'ACCOUNT SECURITY' }),
  },
  {
    name: 'Schedule reminder',
    html: standard('Schedule reminder', [
      'Your project review is coming up.',
      '<strong>Due date:</strong> Friday, August 21, 2026',
      '<strong>Amount:</strong> 25,000 RWF',
    ]),
  },
  {
    name: 'Schedule and expense digest',
    html: standard('Your reminders', [
      'Here are your upcoming reminders:',
      '<ul style="margin:0;padding-left:20px;line-height:1.7;"><li><strong>Project review</strong> — Friday, August 21</li><li><strong>Office rent</strong> — 450,000 RWF · Due now</li></ul>',
    ]),
  },
  {
    name: 'Subscription payment',
    html: standard('Subscription payment reminder', [
      'Your monthly Trippo subscription is due soon.',
      '<strong>Amount:</strong> 10,000 RWF<br><strong>Due date:</strong> August 31, 2026',
      'If you have already paid, you can ignore this reminder.',
    ]),
  },
  {
    name: 'Unread messages',
    html: standard('Unread messages', [
      'You have 2 unread messages:',
      `<ul style="margin:0;padding-left:20px;line-height:1.7;"><li>From <strong>Jane</strong> in <strong>Marketing</strong><br><a href="${appUrl}/messages/group" style="color:#0f3d5e;font-weight:700;text-decoration:underline;">Open message</a></li><li>From <strong>Samuel</strong> in <strong>Finance</strong><br><a href="${appUrl}/messages/group" style="color:#0f3d5e;font-weight:700;text-decoration:underline;">Open message</a></li></ul>`,
    ], { eyebrow: 'MESSAGES', closing: 'Stay connected,' }),
  },
  {
    name: 'Workspace invitation',
    html: standard('Join Sunrise Studio', [
      '<strong>Jane Doe</strong> invited you to join the <strong>Sunrise Studio</strong> workspace on Trippo.',
      'Create your Trippo account with this email address, then accept the invitation.',
    ], {
      eyebrow: 'WORKSPACE INVITATION',
      actionUrl: `${appUrl}/workspace/invite/preview`,
      actionText: 'Accept invitation',
      closing: 'Welcome,',
      footerNote: 'This is a preview. Real invitations expire in 7 days.',
    }),
  },
  {
    name: 'Leave request',
    html: standard('Review requested', [
      '<strong>Jane Doe</strong> submitted a leave request that needs your review.',
      '<ul style="margin:0;padding-left:20px;line-height:1.7;"><li><strong>Type:</strong> Annual leave</li><li><strong>Dates:</strong> Aug 24 – Aug 28, 2026</li><li><strong>Reason:</strong> Family travel</li></ul>',
      'Open <strong>HR → Leave</strong> in Trippo to approve or reject the request.',
    ], { eyebrow: 'LEAVE REQUEST', closing: 'Regards,' }),
  },
  {
    name: 'Leave decision',
    html: standard('Leave approved', [
      'Your annual leave request for Aug 24 – Aug 28, 2026 has been approved.',
      'Open <strong>HR → Leave</strong> in Trippo to view the details.',
    ], { eyebrow: 'LEAVE REQUEST', closing: 'Regards,' }),
  },
  {
    name: 'Approval changes',
    html: standard('Changes requested', [
      'Jane Doe requested changes on your <strong>expense</strong> <strong>Office supplies</strong>.',
      '<strong>Note:</strong> Please attach the receipt before resubmitting.',
      'Open Trippo, edit the item, and resubmit it for approval.',
    ], { eyebrow: 'APPROVAL UPDATE', closing: 'Regards,' }),
  },
  {
    name: 'Admin announcement',
    html: standard('Important update', [
      'We have improved your workspace reporting experience.',
      'You can now review your latest activity and keep your team aligned.',
    ], { eyebrow: 'TRIPPO UPDATE' }),
  },
];

const results = await Promise.all(
  previews.map(async ({ name, html }) => ({
    name,
    result: await sendEmail({
      to: recipient,
      subject: `[Preview] ${name}`,
      text: `Trippo email template preview: ${name}`,
      html,
      fromName: 'Trippo',
    }),
  })),
);

const failed = results.filter(({ result }) => !result.success);
for (const { name, result } of results) {
  console.log(`${result.success ? 'Sent' : 'Failed'}: ${name}${result.messageId ? ` (${result.messageId})` : ''}`);
}
process.exitCode = failed.length ? 1 : 0;
