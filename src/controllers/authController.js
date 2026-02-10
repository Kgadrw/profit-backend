// Authentication Controller
import User from '../models/User.js';
import OTP from '../models/OTP.js';
import { sendEmail } from '../utils/emailService.js';

export const register = async (req, res) => {
  try {
    const { name, email, phone, pin, businessName, role } = req.body;

    // Validation
    if (!name || !pin || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, phone, and PIN are required' });
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    // Validate role
    const userRole = role || 'salon_owner';
    if (userRole !== 'salon_owner') {
      return res.status(400).json({ error: 'Invalid role. Only salon_owner is supported' });
    }

    // Check if user already exists by email
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Create new user
    const userData = {
      name,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      businessName: userRole === 'salon_owner' ? undefined : undefined, // Always leave blank - user sets it in settings
      role: userRole,
      pin,
    };

    const user = new User(userData);
    await user.save();

    // Return user without PIN
    const userResponse = user.toJSON();

    res.status(201).json({
      message: 'Account created successfully',
      user: userResponse,
      role: userResponse.role || 'salon_owner', // Explicitly include role in response
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message || 'Failed to create account' });
  }
};

export const login = async (req, res) => {
  try {
    const { pin, email } = req.body;

    // Validation
    if (!pin || !email) {
      return res.status(400).json({ error: 'Email and PIN are required' });
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    // Check for admin login
    if (email && email.toLowerCase().trim() === 'admin' && pin === '2026') {
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

    // Find user by email (email is now required)
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare PIN
    const isMatch = await user.comparePin(pin);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid PIN' });
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
    // For now, get the first user (for PIN-only system)
    // In production, you'd get user from JWT/session
    const user = await User.findOne();
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

    // Get the first user (for PIN-only system)
    // In production, you'd get user from JWT/session
    const user = await User.findOne();
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

// Change PIN
export const changePin = async (req, res) => {
  try {
    const { currentPin, newPin } = req.body;

    // Validation
    if (!currentPin || !newPin) {
      return res.status(400).json({ error: 'Current PIN and new PIN are required' });
    }

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ error: 'New PIN must be exactly 4 digits' });
    }

    // Get the first user (for PIN-only system)
    const user = await User.findOne();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current PIN
    const isMatch = await user.comparePin(currentPin);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    }

    // Update PIN (will be hashed by pre-save hook)
    user.pin = newPin;
    await user.save();

    res.json({
      message: 'PIN changed successfully',
    });
  } catch (error) {
    console.error('Change PIN error:', error);
    res.status(500).json({ error: error.message || 'Failed to change PIN' });
  }
};

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

// Forgot PIN - Send OTP to email
export const forgotPin = async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({
        message: 'If an account exists with this email, an OTP has been sent.',
      });
    }

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Delete any existing OTPs for this email
    await OTP.deleteMany({ email: email.toLowerCase().trim() });

    // Create new OTP
    const otp = new OTP({
      email: email.toLowerCase().trim(),
      otp: otpCode,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });
    await otp.save();

    // Send OTP email
    const emailHtml = `
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
                    <h1 style="color: #1e293b; margin: 0 0 20px 0; font-size: 24px; font-weight: 600;">PIN Reset Request</h1>
                    <p style="color: #475569; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">Hello ${user.name},</p>
                    <p style="color: #475569; margin: 0 0 30px 0; font-size: 16px; line-height: 1.6;">You requested to reset your PIN. Use the OTP code below to verify your identity:</p>
                    
                    <div style="background-color: #eff6ff; border: 2px solid #2563eb; border-radius: 8px; padding: 20px; margin: 30px 0;">
                      <p style="color: #1e293b; margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Your OTP Code</p>
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

    const emailResult = await sendEmail({
      to: user.email,
      subject: 'PIN Reset OTP - Trippo',
      text: `Your PIN reset OTP is: ${otpCode}. This code will expire in 10 minutes.`,
      html: emailHtml,
      fromName: 'Trippo',
    });

    if (!emailResult.success) {
      console.error('Failed to send OTP email:', emailResult.error);
      // Still return success to user (don't reveal email service issues)
    }

    // Always return success message (security: don't reveal if user exists)
    res.json({
      message: 'If an account exists with this email, an OTP has been sent.',
    });
  } catch (error) {
    console.error('Forgot PIN error:', error);
    res.status(500).json({ error: error.message || 'Failed to process request' });
  }
};

// Reset PIN - Verify OTP and reset PIN
// Check email and return user role (for role detection before login)
export const checkEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists in regular auth
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    
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

export const resetPin = async (req, res) => {
  try {
    const { email, otp, newPin } = req.body;

    // Validation
    if (!email || !otp || !newPin) {
      return res.status(400).json({ error: 'Email, OTP, and new PIN are required' });
    }

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ error: 'New PIN must be exactly 4 digits' });
    }

    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'OTP must be exactly 6 digits' });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Find valid OTP
    const otpRecord = await OTP.findValidOTP(email.toLowerCase().trim(), otp);
    if (!otpRecord) {
      // Increment attempts for any existing OTP
      const existingOTP = await OTP.findOne({
        email: email.toLowerCase().trim(),
        otp,
        used: false,
      });
      if (existingOTP) {
        await existingOTP.incrementAttempts();
      }
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Mark OTP as used
    await otpRecord.markAsUsed();

    // Update PIN (will be hashed by pre-save hook)
    user.pin = newPin;
    await user.save();

    // Delete all OTPs for this email
    await OTP.deleteMany({ email: email.toLowerCase().trim() });

    res.json({
      message: 'PIN reset successfully. You can now login with your new PIN.',
    });
  } catch (error) {
    console.error('Reset PIN error:', error);
    res.status(500).json({ error: error.message || 'Failed to reset PIN' });
  }
};