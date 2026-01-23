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

// Check configuration on module load
checkSmtpConfig();

// Create transporter (configure with your SMTP settings)
const createTransporter = () => {
  // For Gmail, you'll need to use an App Password
  // For other providers, adjust settings accordingly
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  // SMTP_SECURE should be 'true' for port 465, 'false' for port 587
  const secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === true;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (!user || !password) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be set in .env file');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure, // true for 465, false for other ports
    auth: {
      user,
      pass: password, // Use App Password for Gmail
    },
  });

  // Verify connection configuration (async, but don't wait)
  transporter.verify((error, success) => {
    if (error) {
      console.error('❌ SMTP connection verification failed:', error.message);
      console.error('   Please check your SMTP credentials in .env file');
    } else {
      console.log('✅ SMTP server connection verified successfully');
    }
  });

  return transporter;
};

// Generate email header with company logo, name, and sender info
const generateEmailHeader = (senderUser) => {
  const companyName = senderUser.businessName || senderUser.name || 'Trippo';
  // Use publicly accessible logo URL - can be overridden with COMPANY_LOGO_URL env variable
  const companyLogo = process.env.COMPANY_LOGO_URL || 'https://trippo.rw/logo.png';
  const senderName = senderUser.name || 'Unknown';
  const senderEmail = senderUser.email || '';

  return `
    <div style="background-color: #ffffff; padding: 15px 20px; text-align: left; border-bottom: 1px solid #e2e8f0;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img 
          src="${companyLogo}" 
          alt="Trippo Logo" 
          width="40" 
          height="40"
          style="width: 40px; height: 40px; display: block; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; vertical-align: middle;" 
        />
        <h1 style="color: #1e293b; margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.3px; line-height: 40px; vertical-align: middle;">Trippo</h1>
      </div>
    </div>
    <div style="background-color: #f8fafc; padding: 12px 20px; border-bottom: 1px solid #e2e8f0;">
      <div style="background-color: #ffffff; padding: 10px 12px;">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <span style="color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Message From:</span>
          <span style="color: #1e293b; font-size: 13px; font-weight: 600;">${senderName}</span>
          ${senderEmail ? `<span style="color: #64748b; font-size: 12px; margin-left: 4px;">${senderEmail}</span>` : ''}
        </div>
      </div>
    </div>
  `;
};

// Send email function
export const sendEmail = async ({ to, subject, text, html, fromName, fromEmail }) => {
  try {
    // Debug: Check if environment variables are loaded
    const hasSmtpUser = !!process.env.SMTP_USER;
    const hasSmtpPassword = !!process.env.SMTP_PASSWORD;
    
    // Skip if SMTP is not configured
    if (!hasSmtpUser || !hasSmtpPassword) {
      console.warn('Email service not configured. Skipping email send.');
      console.warn('SMTP_USER exists:', hasSmtpUser);
      console.warn('SMTP_PASSWORD exists:', hasSmtpPassword);
      console.log('Would send email to:', to, 'Subject:', subject);
      return { success: false, message: 'Email service not configured' };
    }

    const transporter = createTransporter();

    // Use custom from name/email if provided, otherwise use default
    const fromDisplay = fromName 
      ? `"${fromName}" <${fromEmail || process.env.SMTP_USER}>`
      : `"Trippo" <${process.env.SMTP_USER}>`;

    const mailOptions = {
      from: fromDisplay,
      to,
      subject,
      text,
      html,
      replyTo: fromEmail || process.env.SMTP_USER,
      // Ensure images are loaded in email clients
      headers: {
        'X-Mailer': 'Trippo Email Service',
      },
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};

// Send schedule notification to user
export const sendUserScheduleNotification = async (user, schedule, senderUser) => {
  const message = schedule.userNotificationMessage || 
    `Reminder: ${schedule.title} is due on ${new Date(schedule.dueDate).toLocaleDateString()}`;

  const companyName = senderUser?.businessName || senderUser?.name || 'Trippo';
  const senderName = senderUser?.name || 'Unknown';
  const senderEmail = senderUser?.email || '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9;">
      <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f1f5f9;">
        <tr>
          <td style="padding: 40px 20px;">
            <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              ${generateEmailHeader(senderUser || user)}
              <tr>
                <td style="padding: 30px;">
                  <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 22px; font-weight: 600;">Schedule Reminder</h2>
                  <p style="color: #475569; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello ${user.name},</p>
                  
                  <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <p style="color: #1e293b; margin: 0; font-size: 16px; line-height: 1.8; font-weight: 500;">${message}</p>
                  </div>
                  
                  ${schedule.description ? `
                    <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                      <p style="color: #64748b; margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Details</p>
                      <p style="color: #1e293b; margin: 0; font-size: 15px; line-height: 1.6;">${schedule.description}</p>
                    </div>
                  ` : ''}
                  
                  <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                    ${schedule.amount ? `<p style="color: #1e293b; margin: 0 0 10px 0; font-size: 15px;"><strong style="color: #64748b;">Amount:</strong> <span style="font-size: 18px; font-weight: 600; color: #2563eb;">${schedule.amount.toLocaleString()} RWF</span></p>` : ''}
                    <p style="color: #1e293b; margin: 0; font-size: 15px;"><strong style="color: #64748b;">Due Date:</strong> ${new Date(schedule.dueDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  </div>
                  
                  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                    <p style="color: #64748b; margin: 0 0 5px 0; font-size: 14px;">Best regards,</p>
                    <p style="color: #1e293b; margin: 0; font-size: 15px; font-weight: 600;">Trippo ltd team</p>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Reminder: ${schedule.title}`,
    text: message,
    html,
    fromName: companyName,
    fromEmail: senderEmail || process.env.SMTP_USER,
  });
};

// Send schedule notification to client
export const sendClientScheduleNotification = async (client, schedule, senderUser) => {
  if (!client.email) {
    return { success: false, message: 'Client does not have an email address' };
  }

  const message = schedule.clientNotificationMessage || 
    `This is a reminder that ${schedule.title} is due on ${new Date(schedule.dueDate).toLocaleDateString()}`;

  const companyName = senderUser?.businessName || senderUser?.name || 'Trippo';
  const senderName = senderUser?.name || 'Unknown';
  const senderEmail = senderUser?.email || '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9;">
      <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f1f5f9;">
        <tr>
          <td style="padding: 40px 20px;">
            <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              ${generateEmailHeader(senderUser)}
              <tr>
                <td style="padding: 30px;">
                  <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 22px; font-weight: 600;">Payment Reminder</h2>
                  <p style="color: #475569; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello ${client.name},</p>
                  
                  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <p style="color: #1e293b; margin: 0; font-size: 16px; line-height: 1.8; font-weight: 500;">${message}</p>
                  </div>
                  
                  ${schedule.description ? `
                    <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                      <p style="color: #64748b; margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Details</p>
                      <p style="color: #1e293b; margin: 0; font-size: 15px; line-height: 1.6;">${schedule.description}</p>
                    </div>
                  ` : ''}
                  
                  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 20px 0;">
                    ${schedule.amount ? `<p style="color: #1e293b; margin: 0 0 10px 0; font-size: 15px;"><strong style="color: #92400e;">Amount Due:</strong> <span style="font-size: 18px; font-weight: 600; color: #d97706;">${schedule.amount.toLocaleString()} RWF</span></p>` : ''}
                    <p style="color: #1e293b; margin: 0; font-size: 15px;"><strong style="color: #92400e;">Due Date:</strong> ${new Date(schedule.dueDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  </div>
                  
                  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                    <p style="color: #64748b; margin: 0 0 5px 0; font-size: 14px;">Thank you,</p>
                    <p style="color: #1e293b; margin: 0; font-size: 15px; font-weight: 600;">Trippo ltd team</p>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return await sendEmail({
    to: client.email,
    subject: `Reminder: ${schedule.title}`,
    text: message,
    html,
    fromName: companyName,
    fromEmail: senderEmail || process.env.SMTP_USER,
  });
};

// Send completion notification
export const sendCompletionNotification = async (schedule, senderUser, completionMessage, options = {}) => {
  const { notifyClient = false, notifyUser = false } = options;
  const companyName = senderUser?.businessName || senderUser?.name || 'Trippo';
  const senderName = senderUser?.name || 'Unknown';
  const senderEmail = senderUser?.email || '';

  const message = completionMessage || `The schedule "${schedule.title}" has been marked as completed.`;

  // Send to user if enabled
  if (notifyUser && senderUser?.email) {
    const userHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f1f5f9;">
          <tr>
            <td style="padding: 40px 20px;">
              <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                ${generateEmailHeader(senderUser)}
                <tr>
                  <td style="padding: 30px;">
                    <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 22px; font-weight: 600;">Schedule Completed</h2>
                    <p style="color: #475569; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello ${senderUser.name},</p>
                    
                    <div style="background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 20px; border-radius: 6px; margin: 20px 0;">
                      <p style="color: #1e293b; margin: 0 0 12px 0; font-size: 16px; line-height: 1.8; font-weight: 500;">${message}</p>
                    </div>
                    
                    <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                      <p style="color: #1e293b; margin: 0 0 8px 0; font-size: 15px;"><strong style="color: #64748b;">Schedule:</strong> ${schedule.title}</p>
                      ${schedule.description ? `<p style="color: #1e293b; margin: 8px 0; font-size: 15px;"><strong style="color: #64748b;">Description:</strong> ${schedule.description}</p>` : ''}
                      ${schedule.amount ? `<p style="color: #1e293b; margin: 8px 0 0 0; font-size: 15px;"><strong style="color: #64748b;">Amount:</strong> <span style="font-size: 16px; font-weight: 600; color: #22c55e;">${schedule.amount.toLocaleString()} RWF</span></p>` : ''}
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                      <p style="color: #64748b; margin: 0 0 5px 0; font-size: 14px;">Best regards,</p>
                      <p style="color: #1e293b; margin: 0; font-size: 15px; font-weight: 600;">Trippo ltd team</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    await sendEmail({
      to: senderUser.email,
      subject: `Schedule Completed: ${schedule.title}`,
      text: message,
      html: userHtml,
      fromName: companyName,
      fromEmail: senderEmail || process.env.SMTP_USER,
    });
  }

  // Send to client if enabled and client exists
  if (notifyClient && schedule.clientId && schedule.clientId.email) {
    const clientHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f1f5f9;">
          <tr>
            <td style="padding: 40px 20px;">
              <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                ${generateEmailHeader(senderUser)}
                <tr>
                  <td style="padding: 30px;">
                    <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 22px; font-weight: 600;">Schedule Completed</h2>
                    <p style="color: #475569; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello ${schedule.clientId.name},</p>
                    
                    <div style="background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 20px; border-radius: 6px; margin: 20px 0;">
                      <p style="color: #1e293b; margin: 0; font-size: 16px; line-height: 1.8; font-weight: 500;">${message}</p>
                    </div>
                    
                    <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                      <p style="color: #1e293b; margin: 0 0 8px 0; font-size: 15px;"><strong style="color: #64748b;">Schedule:</strong> ${schedule.title}</p>
                      ${schedule.description ? `<p style="color: #1e293b; margin: 8px 0; font-size: 15px;"><strong style="color: #64748b;">Description:</strong> ${schedule.description}</p>` : ''}
                      ${schedule.amount ? `<p style="color: #1e293b; margin: 8px 0 0 0; font-size: 15px;"><strong style="color: #64748b;">Amount:</strong> <span style="font-size: 16px; font-weight: 600; color: #22c55e;">${schedule.amount.toLocaleString()} RWF</span></p>` : ''}
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                      <p style="color: #64748b; margin: 0 0 5px 0; font-size: 14px;">Thank you,</p>
                      <p style="color: #1e293b; margin: 0; font-size: 15px; font-weight: 600;">Trippo ltd team</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    await sendEmail({
      to: schedule.clientId.email,
      subject: `Schedule Completed: ${schedule.title}`,
      text: message,
      html: clientHtml,
      fromName: companyName,
      fromEmail: senderEmail || process.env.SMTP_USER,
    });
  }
};
