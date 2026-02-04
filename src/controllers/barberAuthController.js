// Barber Authentication Controller
import User from '../models/User.js';
import Barber from '../models/Barber.js';
import OTP from '../models/OTP.js';
import { sendEmail } from '../utils/emailService.js';

export const barberRegister = async (req, res) => {
  try {
    const { name, email, phone, pin, salonOwnerId, barberId } = req.body;

    // Validation
    if (!name || !pin || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, phone, and PIN are required' });
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    // For barber registration, validate salonOwnerId and barberId
    if (!salonOwnerId) {
      return res.status(400).json({ error: 'Salon owner ID is required for barber registration' });
    }
    if (!barberId) {
      return res.status(400).json({ error: 'Barber ID is required for barber registration' });
    }
    
    // Verify salon owner exists
    const salonOwner = await User.findById(salonOwnerId);
    if (!salonOwner || salonOwner.role !== 'salon_owner') {
      return res.status(400).json({ error: 'Invalid salon owner' });
    }

    // Verify barber record exists and belongs to salon owner
    const barber = await Barber.findOne({ _id: barberId, userId: salonOwnerId });
    if (!barber) {
      return res.status(400).json({ error: 'Invalid barber record' });
    }

    // Check if user already exists by email
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Create user with barber role (PIN will be hashed by pre-save hook)
    const user = new User({
      name,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      pin: pin,
      role: 'barber',
      salonOwnerId: salonOwnerId,
      barberId: barberId,
    });
    await user.save();

    // Update barber record with user ID
    await Barber.findByIdAndUpdate(barberId, { barberUserId: user._id });

    // Return user without PIN
    const userResponse = user.toJSON();

    res.status(201).json({
      message: 'Barber account created successfully',
      user: userResponse,
      role: 'barber',
    });
  } catch (error) {
    console.error('Barber registration error:', error);
    res.status(500).json({ error: 'Failed to create barber account. Please try again.' });
  }
};

export const barberLogin = async (req, res) => {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      return res.status(400).json({ error: 'Email and PIN are required' });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or PIN' });
    }

    // Check if user is a barber
    if (user.role !== 'barber') {
      return res.status(403).json({ error: 'This account is not a barber account. Please use the salon owner login.' });
    }

    // Verify PIN using User model method
    const isPinValid = await user.comparePin(pin);
    if (!isPinValid) {
      return res.status(401).json({ error: 'Invalid email or PIN' });
    }

    // Return user without PIN
    const userResponse = user.toJSON();

    res.json({
      message: 'Barber login successful',
      user: { ...userResponse, role: user.role },
      role: user.role,
      isAdmin: false,
    });
  } catch (error) {
    console.error('Barber login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

export const barberForgotPin = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Don't reveal if user exists for security
      return res.json({ message: 'If an account exists with this email, an OTP has been sent.' });
    }

    // Check if user is a barber
    if (user.role !== 'barber') {
      return res.status(403).json({ error: 'This account is not a barber account.' });
    }

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP to database (expires in 10 minutes)
    await OTP.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      {
        email: email.toLowerCase().trim(),
        otp: otpCode,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      },
      { upsert: true, new: true }
    );

    // Send OTP via email
    try {
      await sendEmail({
        to: email,
        subject: 'Trippo - Reset Your PIN',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Reset Your PIN</h2>
            <p>Your OTP code is: <strong>${otpCode}</strong></p>
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({ message: 'If an account exists with this email, an OTP has been sent.' });
  } catch (error) {
    console.error('Barber forgot PIN error:', error);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
};

export const barberResetPin = async (req, res) => {
  try {
    const { email, otp, newPin } = req.body;

    if (!email || !otp || !newPin) {
      return res.status(400).json({ error: 'Email, OTP, and new PIN are required' });
    }

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is a barber
    if (user.role !== 'barber') {
      return res.status(403).json({ error: 'This account is not a barber account.' });
    }

    // Verify OTP
    const otpRecord = await OTP.findOne({ email: email.toLowerCase().trim() });
    if (!otpRecord || otpRecord.otp !== otp) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    if (new Date() > otpRecord.expiresAt) {
      await OTP.deleteOne({ email: email.toLowerCase().trim() });
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // Update user PIN (will be hashed by pre-save hook)
    user.pin = newPin;
    await user.save();

    // Delete OTP
    await OTP.deleteOne({ email: email.toLowerCase().trim() });

    res.json({ message: 'PIN reset successfully' });
  } catch (error) {
    console.error('Barber reset PIN error:', error);
    res.status(500).json({ error: 'Failed to reset PIN. Please try again.' });
  }
};

export const getBarberCurrentUser = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await User.findById(userId).select('-pin');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is a barber
    if (user.role !== 'barber') {
      return res.status(403).json({ error: 'This endpoint is for barbers only' });
    }

    res.json({ user: user.toJSON(), role: user.role });
  } catch (error) {
    console.error('Get barber current user error:', error);
    res.status(500).json({ error: 'Failed to get user information' });
  }
};

export const updateBarberUser = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is a barber
    if (user.role !== 'barber') {
      return res.status(403).json({ error: 'This endpoint is for barbers only' });
    }

    const { name, phone } = req.body;
    if (name) user.name = name;
    if (phone) user.phone = phone;

    await user.save();

    const userResponse = user.toJSON();
    res.json({ message: 'User updated successfully', user: userResponse });
  } catch (error) {
    console.error('Update barber user error:', error);
    res.status(500).json({ error: 'Failed to update user information' });
  }
};

export const changeBarberPin = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { currentPin, newPin } = req.body;

    if (!currentPin || !newPin) {
      return res.status(400).json({ error: 'Current PIN and new PIN are required' });
    }

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is a barber
    if (user.role !== 'barber') {
      return res.status(403).json({ error: 'This endpoint is for barbers only' });
    }

    // Verify current PIN using User model method
    const isPinValid = await user.comparePin(currentPin);
    if (!isPinValid) {
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    }

    // Update PIN (will be hashed by pre-save hook)
    user.pin = newPin;
    await user.save();

    res.json({ message: 'PIN changed successfully' });
  } catch (error) {
    console.error('Change barber PIN error:', error);
    res.status(500).json({ error: 'Failed to change PIN. Please try again.' });
  }
};
