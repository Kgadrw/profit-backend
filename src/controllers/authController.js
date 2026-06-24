// Authentication Controller
import User from '../models/User.js';
import OTP from '../models/OTP.js';
import { sendEmail } from '../utils/emailService.js';
import Sale from '../models/Sale.js';
import mongoose from 'mongoose';
import { SUBSCRIPTION_AMOUNT } from '../utils/paymentPlanUtils.js';
import { tryAdminLogin } from '../utils/platformSettings.js';
import { normalizeAccountPhone } from '../utils/phoneUtils.js';
import { isValidPassword, PASSWORD_MIN_LENGTH } from '../utils/passwordUtils.js';
import { OAuth2Client } from 'google-auth-library';

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleOAuthClient = googleClientId ? new OAuth2Client(googleClientId) : null;

async function verifyGoogleCredential(credential) {
  if (!googleOAuthClient || !googleClientId) {
    throw new Error('Google sign-in is not configured');
  }

  const ticket = await googleOAuthClient.verifyIdToken({
    idToken: credential,
    audience: googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) {
    throw new Error('Invalid Google token');
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase().trim(),
    name: (payload.name || payload.email.split('@')[0] || 'User').trim(),
    emailVerified: payload.email_verified === true,
  };
}

function resolveAuthProvider(user) {
  if (user.googleId && (user.password || user.pin)) {
    return 'both';
  }
  if (user.googleId) {
    return 'google';
  }
  return 'local';
}

async function linkGoogleProfile(user, profile) {
  if (!user.googleId) {
    user.googleId = profile.googleId;
  }
  user.authProvider = resolveAuthProvider(user);
  await user.save();
  return user;
}

function buildGoogleUserResponse(user, { merged = false, created = false } = {}) {
  const userResponse = user.toJSON();
  return {
    message: created ? 'Account created successfully' : 'Login successful',
    user: userResponse,
    isAdmin: false,
    role: userResponse.role || 'salon_owner',
    merged,
    created,
  };
}

async function createGoogleUser(profile) {
  const user = new User({
    name: profile.name,
    email: profile.email,
    googleId: profile.googleId,
    authProvider: 'google',
    role: 'salon_owner',
    paymentPlan: {
      active: true,
      planName: 'Plus',
      amount: SUBSCRIPTION_AMOUNT,
      currency: 'RWF',
      intervalMonths: 1,
    },
  });
  await user.save();

  const startDate = user.createdAt || new Date();
  const trialEndsAt = new Date(startDate);
  trialEndsAt.setDate(trialEndsAt.getDate() + 7);
  user.paymentPlan = {
    ...(user.paymentPlan || {}),
    startDate,
    trialEndsAt,
    nextDueDate: trialEndsAt,
    status: 'active',
  };
  await user.save();
  return user;
}

function buildOtpEmailHtml({ title, greeting, bodyText, otpCode }) {
  return `
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
              <tr>
                <td style="background-color: #ffffff; padding: 30px; text-align: center;">
                  <h1 style="color: #1e293b; margin: 0 0 20px 0; font-size: 24px; font-weight: 600;">${title}</h1>
                  <p style="color: #475569; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">${greeting}</p>
                  <p style="color: #475569; margin: 0 0 30px 0; font-size: 16px; line-height: 1.6;">${bodyText}</p>
                  <div style="background-color: #eff6ff; border: 2px solid #2563eb; border-radius: 8px; padding: 20px; margin: 30px 0;">
                    <p style="color: #1e293b; margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Your verification code</p>
                    <p style="color: #2563eb; margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: monospace;">${otpCode}</p>
                  </div>
                  <p style="color: #64748b; margin: 20px 0 0 0; font-size: 14px; line-height: 1.6;">This code will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
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
}

async function createAndSendOtp({ email, purpose, subject, title, greeting, bodyText, textPrefix }) {
  const normalizedEmail = email.toLowerCase().trim();
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

  await OTP.deleteMany({ email: normalizedEmail, purpose });

  const otp = new OTP({
    email: normalizedEmail,
    otp: otpCode,
    purpose,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  await otp.save();

  const emailResult = await sendEmail({
    to: normalizedEmail,
    subject,
    text: `${textPrefix} ${otpCode}. This code will expire in 10 minutes.`,
    html: buildOtpEmailHtml({ title, greeting, bodyText, otpCode }),
    fromName: 'Trippo',
  });

  if (!emailResult.success) {
    await OTP.deleteMany({ email: normalizedEmail, purpose, otp: otpCode });
    const reason = emailResult.error || emailResult.message || 'Email delivery failed';
    console.error(`Failed to send ${purpose} OTP email to ${normalizedEmail}:`, reason);
    return { ok: false, error: reason };
  }

  return { ok: true, otpCode };
}

export const sendRegistrationOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const sendResult = await createAndSendOtp({
      email: normalizedEmail,
      purpose: 'registration',
      subject: 'Verify your email - Trippo',
      title: 'Verify your email',
      greeting: 'Hello,',
      bodyText: 'Use the verification code below to complete your Trippo account registration:',
      textPrefix: 'Your Trippo email verification code is:',
    });

    if (!sendResult.ok) {
      return res.status(503).json({
        error: 'We could not send the verification email. Please try again in a few minutes.',
        code: 'OTP_EMAIL_FAILED',
      });
    }

    res.json({
      message: 'A verification code has been sent to your email.',
    });
  } catch (error) {
    console.error('Send registration OTP error:', error);
    res.status(500).json({ error: error.message || 'Failed to send verification code' });
  }
};

export const register = async (req, res) => {
  try {
    const { name, email, phone, password, businessName, role, otp } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    if (!name || !password || !email || !phone || !otp) {
      return res.status(400).json({ error: 'Name, email, phone, password, and verification code are required' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` });
    }

    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'Verification code must be exactly 6 digits' });
    }

    // Validate role
    const userRole = role || 'salon_owner';
    if (userRole !== 'salon_owner') {
      return res.status(400).json({ error: 'Invalid role. Only salon_owner is supported' });
    }

    // Check if user already exists by email
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const otpRecord = await OTP.findValidOTP(normalizedEmail, otp, 'registration');
    if (!otpRecord) {
      const existingOTP = await OTP.findOne({
        email: normalizedEmail,
        otp,
        purpose: 'registration',
        used: false,
      });
      if (existingOTP) {
        await existingOTP.incrementAttempts();
      }
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    await otpRecord.markAsUsed();

    // Create new user
    const userData = {
      name: String(name).trim(),
      email: normalizedEmail,
      phone: normalizeAccountPhone(phone),
      businessName: userRole === 'salon_owner' ? undefined : undefined, // Always leave blank - user sets it in settings
      role: userRole,
      password,
      authProvider: 'local',
      paymentPlan: {
        active: true,
        planName: 'Plus',
        amount: SUBSCRIPTION_AMOUNT,
        currency: 'RWF',
        intervalMonths: 1,
        // startDate/trialEndsAt/nextDueDate set after save when createdAt exists
      }
    };

    const user = new User(userData);
    await user.save();

    // 7-day Plus trial from account creation; first payment due when trial ends
    const startDate = user.createdAt || new Date();
    const trialEndsAt = new Date(startDate);
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);
    user.paymentPlan = {
      ...(user.paymentPlan || {}),
      startDate,
      trialEndsAt,
      nextDueDate: trialEndsAt,
      status: 'active',
    };
    await user.save();

    await OTP.deleteMany({ email: normalizedEmail, purpose: 'registration' });

    // Return user without PIN
    const userResponse = user.toJSON();

    res.status(201).json({
      message: 'Account created successfully',
      user: userResponse,
      role: userResponse.role || 'salon_owner', // Explicitly include role in response
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error?.code === 11000) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    if (error?.name === 'ValidationError') {
      const first = Object.values(error.errors || {})[0];
      return res.status(400).json({
        error: first?.message || 'Invalid account details',
      });
    }
    res.status(500).json({ error: error.message || 'Failed to create account' });
  }
};

export const login = async (req, res) => {
  try {
    const { password, email } = req.body;
    const normalizedEmail = email ? email.toLowerCase().trim() : '';

    if (!password || !email) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (await tryAdminLogin(normalizedEmail, password)) {
      return res.json({
        message: 'Admin login successful',
        user: {
          name: 'Admin',
          email: 'admin',
          phone: '0000000000',
          businessName: 'System Administrator',
          role: 'admin',
        },
        isAdmin: true,
      });
    }

    // Legacy fallback removed — admin credentials live in platform settings

    const user = await User.findOne({ email: normalizedEmail }).select('+pin');

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Return user without PIN
    const userResponse = user.toJSON();

    res.json({
      message: 'Login successful',
      user: userResponse,
      isAdmin: false,
      role: userResponse.role || 'salon_owner',
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
};

// Get current user (if you implement session/JWT auth later)
export const getCurrentUser = async (req, res) => {
  try {
    if (req.user?.isAdmin) {
      return res.json({
        user: {
          name: 'Admin',
          email: 'admin',
          phone: '0000000000',
          businessName: 'System Administrator',
          role: 'admin',
        },
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userResponse = user.toJSON();
    res.json({ user: userResponse });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update user information
export const updateUser = async (req, res) => {
  try {
    const { name, email, phone, businessName } = req.body;

    if (req.user?.isAdmin) {
      return res.status(403).json({ error: 'Admin profile cannot be updated through this endpoint' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update fields if provided
    if (name !== undefined) {
      user.name = name.trim();
    }
    if (email !== undefined) {
      // Validate email
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }
      // Check if email is already taken by another user
      const existingUser = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: user._id } });
      if (existingUser) {
        return res.status(400).json({ error: 'Email is already taken by another user' });
      }
      user.email = email.trim().toLowerCase();
    }
    if (phone !== undefined) {
      user.phone = phone.trim();
    }
    if (businessName !== undefined) {
      // Allow user to set business name or leave it blank (empty string becomes undefined)
      user.businessName = businessName.trim() || undefined;
    }

    await user.save();
    const userResponse = user.toJSON();

    res.json({
      message: 'User updated successfully',
      user: userResponse,
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
};

// Public ticket verification (NO AUTH)
// Always returns 200 with { valid: true/false } to avoid "route not found" / 404 confusion.
export const verifyTicket = async (req, res) => {
  try {
    const ticket = String(req.query.ticket || "").trim();
    if (!ticket) {
      return res.status(200).json({ valid: false });
    }

    // Prevent cast errors on invalid ids
    if (!mongoose.Types.ObjectId.isValid(ticket)) {
      return res.status(200).json({ valid: false });
    }

    const sale = await Sale.findById(ticket).lean();
    if (!sale) {
      return res.status(200).json({ valid: false });
    }

    // Return only safe, verification-friendly fields (no userId, no internal fields)
    return res.status(200).json({
      valid: true,
      ticketId: String(sale._id),
      serviceName: sale.serviceName || sale.product || "Service",
      barberName: sale.workerName || "",
      amount: Number(sale.revenue || 0),
      currency: "RWF",
      paymentMethod: sale.paymentMethod || "cash",
      recordedAt: sale.timestamp || sale.date || sale.createdAt,
    });
  } catch (error) {
    // Never fail hard for public verification
    console.error("Verify ticket error:", error);
    return res.status(200).json({ valid: false });
  }
};

// Change password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: `New password must be at least ${PASSWORD_MIN_LENGTH} characters` });
    }

    const user = await User.findById(req.user._id).select('+pin');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password = newPassword;
    user.pin = undefined;
    user.authProvider = user.googleId ? 'both' : 'local';
    await user.save();

    res.json({
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: error.message || 'Failed to change password' });
  }
};

export const changePin = changePassword;

// Delete user account and all associated data
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id; // From authenticateUser middleware

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting admin user
    if (user.email === 'admin') {
      return res.status(403).json({ error: 'Cannot delete admin user' });
    }

    // Import models
    const Product = (await import('../models/Product.js')).default;
    const Sale = (await import('../models/Sale.js')).default;
    const Client = (await import('../models/Client.js')).default;
    const Schedule = (await import('../models/Schedule.js')).default;

    // Delete all associated data
    const deletedProducts = await Product.deleteMany({ userId });
    const deletedSales = await Sale.deleteMany({ userId });
    const deletedClients = await Client.deleteMany({ userId });
    const deletedSchedules = await Schedule.deleteMany({ userId });

    // Delete the user
    await User.findByIdAndDelete(userId);

    res.json({
      message: 'Account and all associated data deleted successfully',
      data: {
        userId,
        deletedProducts: deletedProducts.deletedCount,
        deletedSales: deletedSales.deletedCount,
        deletedClients: deletedClients.deletedCount,
        deletedSchedules: deletedSchedules.deletedCount,
      },
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete account' });
  }
};

// Forgot password - Send OTP to email
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.json({
        message: 'If an account exists with this email, an OTP has been sent.',
      });
    }

    const sendResult = await createAndSendOtp({
      email: user.email,
      purpose: 'password_reset',
      subject: 'Password Reset - Trippo',
      title: 'Password Reset Request',
      greeting: `Hello ${user.name},`,
      bodyText: 'You requested to reset your password. Use the verification code below to verify your identity:',
      textPrefix: 'Your password reset code is:',
    });

    if (!sendResult.ok) {
      return res.status(503).json({
        error: 'We could not send the reset code to your email. Please try again in a few minutes or contact support.',
        code: 'OTP_EMAIL_FAILED',
      });
    }

    res.json({
      message: 'If an account exists with this email, an OTP has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: error.message || 'Failed to process request' });
  }
};

export const forgotPin = forgotPassword;

// Reset PIN - Verify OTP and reset PIN
// Check email and return user role (for role detection before login)
export const checkEmail = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email ? email.toLowerCase().trim() : '';

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Detect admin aliases up-front for role-aware UI flows
    if (['admin', 'admin@trippo.rw', 'admin@trippo.com'].includes(normalizedEmail)) {
      return res.json({
        exists: true,
        role: 'admin',
      });
    }

    // Check if user exists in regular auth
    const user = await User.findOne({ email: normalizedEmail });
    
    if (user) {
      return res.json({
        exists: true,
        role: user.role || 'salon_owner',
      });
    }

    // User doesn't exist
    return res.json({
      exists: false,
      role: null,
    });
  } catch (error) {
    console.error('Check email error:', error);
    res.status(500).json({ error: error.message || 'Failed to check email' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword, newPin } = req.body;
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const normalizedOtp = String(otp || '').trim();
    const nextPassword = newPassword || newPin;

    if (!normalizedEmail || !normalizedOtp || !nextPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    if (!isValidPassword(nextPassword)) {
      return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` });
    }

    if (normalizedOtp.length !== 6 || !/^\d{6}$/.test(normalizedOtp)) {
      return res.status(400).json({ error: 'OTP must be exactly 6 digits' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const otpRecord = await OTP.findValidOTP(normalizedEmail, normalizedOtp, 'password_reset');
    if (!otpRecord) {
      const latestOtp = await OTP.findOne({
        email: normalizedEmail,
        purpose: { $in: ['password_reset', 'pin_reset'] },
        used: false,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

      if (latestOtp) {
        await latestOtp.incrementAttempts();
      }

      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    await otpRecord.markAsUsed();

    user.password = nextPassword;
    user.pin = undefined;
    user.authProvider = user.googleId ? 'both' : 'local';
    await user.save();

    await OTP.deleteMany({
      email: normalizedEmail,
      purpose: { $in: ['password_reset', 'pin_reset'] },
    });

    res.json({
      message: 'Password reset successfully. You can now sign in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: error.message || 'Failed to reset password' });
  }
};

export const resetPin = resetPassword;

export const googleAuth = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    let profile;
    try {
      profile = await verifyGoogleCredential(credential);
    } catch (error) {
      console.error('Google token verification failed:', error);
      return res.status(401).json({ error: 'Invalid Google sign-in. Please try again.' });
    }

    if (!profile.emailVerified) {
      return res.status(400).json({ error: 'Your Google email must be verified.' });
    }

    let user = await User.findOne({
      $or: [{ googleId: profile.googleId }, { email: profile.email }],
    }).select('+pin');

    if (user) {
      const hadGoogle = Boolean(user.googleId);
      await linkGoogleProfile(user, profile);
      return res.json(buildGoogleUserResponse(user, { merged: !hadGoogle }));
    }

    const newUser = await createGoogleUser(profile);
    return res.status(201).json(buildGoogleUserResponse(newUser, { created: true }));
  } catch (error) {
    console.error('Google auth error:', error);
    if (error?.code === 11000) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    res.status(500).json({ error: error.message || 'Google sign-in failed' });
  }
};