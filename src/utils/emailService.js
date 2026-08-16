// Email Service using Nodemailer
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from backend directory (parent of src/utils)
// Use override: false to not override existing env vars (in case index.js already loaded them)
const envPath = join(__dirname, '../../.env');
const result = dotenv.config({ path: envPath, override: false });
if (result.error) {
  console.warn('Warning: Could not load .env file from:', envPath);
  console.warn('Error:', result.error.message);
} else {
  console.log('✅ Email service: .env file loaded from:', envPath);
}

/** Production app origin for email deep links. Never fall back to localhost. */
const DEFAULT_FRONTEND_URL = 'https://bookfy.trippo.rw';

export function getFrontendBaseUrl() {
  const configured = String(process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
  if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) {
    return configured;
  }
  return DEFAULT_FRONTEND_URL;
}

// Check SMTP configuration on module load
const checkSmtpConfig = () => {
  const hasUser = !!process.env.SMTP_USER;
  const hasPassword = !!process.env.SMTP_PASSWORD;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = process.env.SMTP_PORT || '587';

  if (hasUser && hasPassword) {
    console.log('✅ Email service: SMTP configuration found');
    console.log(`   Host: ${host}, Port: ${port}, User: ${process.env.SMTP_USER}`);
  } else {
    console.warn('⚠️  Email service: SMTP not fully configured');
    console.warn(`   SMTP_USER: ${hasUser ? '✓' : '✗'}`);
    console.warn(`   SMTP_PASSWORD: ${hasPassword ? '✓' : '✗'}`);
    console.warn('   Please set SMTP_USER and SMTP_PASSWORD in your .env file');
  }
};

checkSmtpConfig();

const createTransporter = () => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === true;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (!user || !password) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be set in .env file');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass: password,
    },
  });

  transporter.verify((error) => {
    if (error) {
      console.error('❌ SMTP connection verification failed:', error.message);
      console.error('   Please check your SMTP credentials in .env file');
    } else {
      console.log('✅ SMTP server connection verified successfully');
    }
  });

  return transporter;
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayCompanyName(senderUser) {
  return senderUser?.businessName || senderUser?.name || '';
}

const emailSignature = (senderUser) => {
  const companyName = displayCompanyName(senderUser);
  return escapeHtml(companyName || 'Trippo');
};

/**
 * Shared, email-client-safe layout for every Trippo email.
 * Uses solid colors and borders only; no gradients or shadows.
 */
export function renderEmailTemplate({
  eyebrow = 'TRIPPO',
  title,
  greeting,
  paragraphs = [],
  actionUrl,
  actionText,
  closing,
  senderUser,
  footerNote,
}) {
  const body = paragraphs
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#243044;">${p}</p>`,
    )
    .join('');

  const signature = closing
    ? `<p style="margin:26px 0 0;font-size:15px;line-height:1.6;color:#243044;">${escapeHtml(closing)}<br><strong>${emailSignature(senderUser)}</strong></p>`
    : '';
  const action = actionUrl && actionText
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 4px;"><tr><td style="border-radius:6px;background:#0f3d5e;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 20px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;">${escapeHtml(actionText)}</a></td></tr></table>`
    : '';
  const note = footerNote
    ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.55;color:#667085;">${footerNote}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f3f6f8;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6f8;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #d9e1e8;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:22px 32px;background:#0f3d5e;border-bottom:4px solid #20a39e;">
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1.4px;line-height:1.4;color:#d8f1ef;">${escapeHtml(eyebrow)}</p>
          <p style="margin:6px 0 0;font-size:22px;font-weight:700;line-height:1.25;color:#ffffff;">${escapeHtml(title || 'An update from Trippo')}</p>
        </td></tr>
        <tr><td style="padding:30px 32px 28px;">
          ${greeting ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#243044;">${greeting}</p>` : ''}
          ${body}
          ${action}
          ${signature}
          ${note}
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #e5eaf0;background:#fafcfd;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#667085;">Sent by Trippo · Manage your work with clarity</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function plainEmailHtml({ title, greeting, paragraphs = [], closing, senderUser }) {
  return renderEmailTemplate({ title, greeting, paragraphs, closing, senderUser });
}

function formatDueDate(dateValue) {
  return new Date(dateValue).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export const sendEmail = async ({ to, subject, text, html, fromName, fromEmail, replyToEmail }) => {
  try {
    const hasSmtpUser = !!process.env.SMTP_USER;
    const hasSmtpPassword = !!process.env.SMTP_PASSWORD;

    if (!hasSmtpUser || !hasSmtpPassword) {
      console.warn('Email service not configured. Skipping email send.');
      console.warn('SMTP_USER exists:', hasSmtpUser);
      console.warn('SMTP_PASSWORD exists:', hasSmtpPassword);
      console.log('Would send email to:', to, 'Subject:', subject);
      return { success: false, message: 'Email service not configured' };
    }

    const transporter = createTransporter();
    const smtpUser = process.env.SMTP_USER;
    const displayName = fromName || process.env.SMTP_FROM_NAME || 'Notifications';
    const replyTo = replyToEmail || fromEmail || process.env.SMTP_REPLY_TO || smtpUser;

    const mailOptions = {
      from: `"${displayName}" <${smtpUser}>`,
      to,
      subject,
      text,
      html,
      replyTo,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId, `(From: ${displayName} <${smtpUser}>)`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};

export const sendUserScheduleNotification = async (user, schedule, senderUser) => {
  const message =
    schedule.userNotificationMessage ||
    `Reminder: ${schedule.title} is due on ${new Date(schedule.dueDate).toLocaleDateString()}`;

  const sender = senderUser || user;
  const companyName = displayCompanyName(sender) || 'Notifications';
  const senderEmail = sender?.email || '';
  const dueText = formatDueDate(schedule.dueDate);

  const paragraphs = [
    escapeHtml(message),
    schedule.description ? escapeHtml(schedule.description) : '',
    schedule.amount ? `Amount: ${Number(schedule.amount).toLocaleString()} RWF` : '',
    `Due date: ${escapeHtml(dueText)}`,
  ];

  const textParts = [
    `Hello ${user.name},`,
    '',
    message,
    schedule.description || '',
    schedule.amount ? `Amount: ${Number(schedule.amount).toLocaleString()} RWF` : '',
    `Due date: ${dueText}`,
  ].filter(Boolean);

  return await sendEmail({
    to: user.email,
    subject: `Reminder: ${schedule.title}`,
    text: textParts.join('\n'),
    html: plainEmailHtml({
      title: 'Schedule reminder',
      greeting: `Hello ${escapeHtml(user.name)},`,
      paragraphs,
      closing: 'Best regards,',
      senderUser: sender,
    }),
    fromName: companyName,
    replyToEmail: senderEmail || undefined,
  });
};

export const sendClientScheduleNotification = async (client, schedule, senderUser) => {
  if (!client.email) {
    return { success: false, message: 'Client does not have an email address' };
  }

  const message =
    schedule.clientNotificationMessage ||
    `This is a reminder that ${schedule.title} is due on ${new Date(schedule.dueDate).toLocaleDateString()}`;

  const companyName = displayCompanyName(senderUser) || 'Notifications';
  const senderEmail = senderUser?.email || '';
  const dueText = formatDueDate(schedule.dueDate);

  const paragraphs = [
    escapeHtml(message),
    schedule.description ? escapeHtml(schedule.description) : '',
    schedule.amount ? `Amount due: ${Number(schedule.amount).toLocaleString()} RWF` : '',
    `Due date: ${escapeHtml(dueText)}`,
  ];

  const textParts = [
    `Hello ${client.name},`,
    '',
    message,
    schedule.description || '',
    schedule.amount ? `Amount due: ${Number(schedule.amount).toLocaleString()} RWF` : '',
    `Due date: ${dueText}`,
  ].filter(Boolean);

  return await sendEmail({
    to: client.email,
    subject: `Reminder: ${schedule.title}`,
    text: textParts.join('\n'),
    html: plainEmailHtml({
      title: 'Schedule reminder',
      greeting: `Hello ${escapeHtml(client.name)},`,
      paragraphs,
      closing: 'Thank you,',
      senderUser,
    }),
    fromName: companyName,
    replyToEmail: senderEmail || undefined,
  });
};

export const sendUserScheduleDigest = async (user, schedules, senderUser) => {
  const sender = senderUser || user;
  const companyName = displayCompanyName(sender) || 'Notifications';
  const senderEmail = sender?.email || '';
  const count = schedules.length;
  const subject = `You have ${count} schedule reminders`;

  const paragraphs = schedules.map((schedule) => {
    const dueText = formatDueDate(schedule.dueDate);
    const amount = schedule.amount
      ? ` · ${Number(schedule.amount).toLocaleString()} RWF`
      : '';
    return `<strong>${escapeHtml(schedule.title)}</strong> — due ${escapeHtml(dueText)}${amount}`;
  });

  const textParts = [
    `Hello ${user.name},`,
    '',
    `You have ${count} schedule reminders:`,
    ...schedules.map((schedule, index) => {
      const dueText = formatDueDate(schedule.dueDate);
      const amount = schedule.amount
        ? ` (${Number(schedule.amount).toLocaleString()} RWF)`
        : '';
      return `${index + 1}. ${schedule.title} — due ${dueText}${amount}`;
    }),
  ];

  return await sendEmail({
    to: user.email,
    subject,
    text: textParts.join('\n'),
    html: plainEmailHtml({
      title: 'Your schedule reminders',
      greeting: `Hello ${escapeHtml(user.name)},`,
      paragraphs: [
        `You have ${count} schedule reminders:`,
        ...paragraphs,
      ],
      closing: 'Best regards,',
      senderUser: sender,
    }),
    fromName: companyName,
    replyToEmail: senderEmail || undefined,
  });
};

export const sendClientScheduleDigest = async (client, schedules, senderUser) => {
  if (!client.email) {
    return { success: false, message: 'Client does not have an email address' };
  }

  const companyName = displayCompanyName(senderUser) || 'Notifications';
  const senderEmail = senderUser?.email || '';
  const count = schedules.length;
  const subject = `You have ${count} reminders`;

  const paragraphs = schedules.map((schedule) => {
    const dueText = formatDueDate(schedule.dueDate);
    const amount = schedule.amount
      ? ` · ${Number(schedule.amount).toLocaleString()} RWF`
      : '';
    return `<strong>${escapeHtml(schedule.title)}</strong> — due ${escapeHtml(dueText)}${amount}`;
  });

  const textParts = [
    `Hello ${client.name},`,
    '',
    `You have ${count} reminders:`,
    ...schedules.map((schedule, index) => {
      const dueText = formatDueDate(schedule.dueDate);
      const amount = schedule.amount
        ? ` (${Number(schedule.amount).toLocaleString()} RWF)`
        : '';
      return `${index + 1}. ${schedule.title} — due ${dueText}${amount}`;
    }),
  ];

  return await sendEmail({
    to: client.email,
    subject,
    text: textParts.join('\n'),
    html: plainEmailHtml({
      title: 'Your reminders',
      greeting: `Hello ${escapeHtml(client.name)},`,
      paragraphs: [`You have ${count} reminders:`, ...paragraphs],
      closing: 'Thank you,',
      senderUser,
    }),
    fromName: companyName,
    replyToEmail: senderEmail || undefined,
  });
};

export const sendMonthlyPaymentReminder = async (user, plan, senderUser) => {
  if (!user?.email) {
    return { success: false, message: 'User does not have an email address' };
  }

  const amount = Number(plan?.amount || 5800);
  const currency = String(plan?.currency || 'RWF');
  const nextDue = plan?.nextDueDate ? new Date(plan.nextDueDate) : null;
  const dueText = nextDue
    ? nextDue.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'soon';

  const companyName = displayCompanyName(senderUser || user) || 'Notifications';
  const senderEmail = senderUser?.email || process.env.SMTP_USER;

  const subject = `Monthly subscription payment reminder (${amount.toLocaleString()} ${currency})`;
  const message = `Hello ${user.name}, this is a reminder to pay your monthly subscription of ${amount.toLocaleString()} ${currency}. Due date: ${dueText}.`;

  const paragraphs = [
    `Your monthly subscription is ${amount.toLocaleString()} ${escapeHtml(currency)}.`,
    nextDue ? `The due date is ${escapeHtml(dueText)}.` : '',
    'If you have already paid, you can ignore this reminder.',
  ];

  return await sendEmail({
    to: user.email,
    subject,
    text: message,
    html: plainEmailHtml({
      title: 'Subscription payment reminder',
      greeting: `Hello ${escapeHtml(user.name)},`,
      paragraphs,
      closing: 'Best regards,',
      senderUser: senderUser || user,
    }),
    fromName: companyName,
    replyToEmail: senderEmail || undefined,
  });
};

export const sendRecurringExpenseReminder = async (user, recurringExpense, context = {}) => {
  if (!user?.email) {
    return { success: false, message: 'User does not have an email address' };
  }

  const stage = context.stage || 'due';
  const amount = Number(recurringExpense.amount || 0);
  const dueDate = recurringExpense.nextDueDate ? new Date(recurringExpense.nextDueDate) : null;
  const dueText = dueDate ? formatDueDate(recurringExpense.nextDueDate) : 'soon';
  const isDueToday = stage === 'due';

  const subject = isDueToday
    ? `Payment pending: ${recurringExpense.title} (${amount.toLocaleString()} RWF)`
    : `Upcoming expense: ${recurringExpense.title} due ${dueText}`;

  const message = isDueToday
    ? `Your recurring expense "${recurringExpense.title}" of ${amount.toLocaleString()} RWF is due today. Please make the payment and record it.`
    : `Reminder: your recurring expense "${recurringExpense.title}" of ${amount.toLocaleString()} RWF is due on ${dueText}.`;

  const paragraphs = [
    escapeHtml(message),
    `Amount: ${amount.toLocaleString()} RWF`,
    dueDate ? `Due date: ${escapeHtml(dueText)}` : '',
    recurringExpense.category ? `Category: ${escapeHtml(recurringExpense.category)}` : '',
    recurringExpense.autoRecord
      ? 'This expense will be recorded automatically when due.'
      : 'After you pay, open Expenses and mark it as paid.',
  ];

  return await sendEmail({
    to: user.email,
    subject,
    text: message,
    html: plainEmailHtml({
      title: isDueToday ? 'Expense payment due' : 'Upcoming expense',
      greeting: `Hello ${escapeHtml(user.name)},`,
      paragraphs,
      closing: 'Best regards,',
      senderUser: user,
    }),
    fromName: displayCompanyName(user) || 'Notifications',
    replyToEmail: user.email || undefined,
  });
};

export const sendRecurringExpenseDigest = async (user, items) => {
  if (!user?.email || !items?.length) {
    return { success: false, message: 'Nothing to send' };
  }

  if (items.length === 1) {
    return sendRecurringExpenseReminder(user, items[0].expense, { stage: items[0].stage });
  }

  const subject = `You have ${items.length} expense reminders`;
  const paragraphs = items.map(({ expense, stage }) => {
    const amount = Number(expense.amount || 0);
    const dueText = expense.nextDueDate ? formatDueDate(expense.nextDueDate) : 'soon';
    const label = stage === 'due' ? 'Due now' : 'Upcoming';
    return `<strong>${escapeHtml(expense.title)}</strong> — ${label} · ${amount.toLocaleString()} RWF · ${escapeHtml(dueText)}`;
  });

  const text = [
    `Hello ${user.name},`,
    '',
    `You have ${items.length} expense reminders:`,
    ...items.map(({ expense, stage }, index) => {
      const amount = Number(expense.amount || 0);
      const dueText = expense.nextDueDate ? formatDueDate(expense.nextDueDate) : 'soon';
      return `${index + 1}. ${expense.title} (${stage === 'due' ? 'due now' : 'upcoming'}) — ${amount.toLocaleString()} RWF — ${dueText}`;
    }),
  ].join('\n');

  return await sendEmail({
    to: user.email,
    subject,
    text,
    html: plainEmailHtml({
      title: 'Your expense reminders',
      greeting: `Hello ${escapeHtml(user.name)},`,
      paragraphs: [`You have ${items.length} expense reminders:`, ...paragraphs],
      closing: 'Best regards,',
      senderUser: user,
    }),
    fromName: displayCompanyName(user) || 'Notifications',
    replyToEmail: user.email || undefined,
  });
};

export const sendCompletionNotification = async (schedule, senderUser, completionMessage, options = {}) => {
  const { notifyClient = false, notifyUser = false } = options;
  const companyName = displayCompanyName(senderUser) || 'Notifications';
  const senderEmail = senderUser?.email || '';
  const message =
    completionMessage || `The schedule "${schedule.title}" has been marked as completed.`;

  const detailParagraphs = [
    escapeHtml(message),
    `Schedule: ${escapeHtml(schedule.title)}`,
    schedule.description ? `Description: ${escapeHtml(schedule.description)}` : '',
    schedule.amount ? `Amount: ${Number(schedule.amount).toLocaleString()} RWF` : '',
  ];

  if (notifyUser && senderUser?.email) {
    await sendEmail({
      to: senderUser.email,
      subject: `Schedule Completed: ${schedule.title}`,
      text: message,
      html: plainEmailHtml({
        title: 'Schedule completed',
        greeting: `Hello ${escapeHtml(senderUser.name)},`,
        paragraphs: detailParagraphs,
        closing: 'Best regards,',
        senderUser,
      }),
      fromName: companyName,
      replyToEmail: senderEmail || undefined,
    });
  }

  if (notifyClient && schedule.clientId && schedule.clientId.email) {
    await sendEmail({
      to: schedule.clientId.email,
      subject: `Schedule Completed: ${schedule.title}`,
      text: message,
      html: plainEmailHtml({
        title: 'Schedule completed',
        greeting: `Hello ${escapeHtml(schedule.clientId.name)},`,
        paragraphs: detailParagraphs,
        closing: 'Thank you,',
        senderUser,
      }),
      fromName: companyName,
      replyToEmail: senderEmail || undefined,
    });
  }
};
