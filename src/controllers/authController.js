// Authentication Controller
import User from '../models/User.js';

export const register = async (req, res) => {
  try {
    const { name, email, pin, businessName } = req.body;

    // Validation
    if (!name || !pin) {
      return res.status(400).json({ error: 'Name and PIN are required' });
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    // Check if user already exists (by email if provided, or check if any user exists for PIN-based system)
    // For this simple system, we'll allow multiple users but they must have unique emails if provided
    if (email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'User with this email already exists' });
      }
    }

    // Create new user
    const user = new User({
      name,
      email: email || undefined,
      businessName: businessName || undefined,
      pin,
    });

    await user.save();

    // Return user without PIN
    const userResponse = user.toJSON();

    res.status(201).json({
      message: 'Account created successfully',
      user: userResponse,
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
    if (!pin) {
      return res.status(400).json({ error: 'PIN is required' });
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
          businessName: 'System Administrator',
          role: 'admin',
        },
        isAdmin: true,
      });
    }

    // Find user by email if provided, otherwise get the first user (for PIN-only system)
    let user;
    if (email) {
      user = await User.findOne({ email });
    } else {
      // For PIN-only system, get the first user (assuming single user per device)
      // In production, you'd want to track which user is logged in per session
      user = await User.findOne();
    }

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
    const { name, email, businessName } = req.body;

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
      if (email === '' || email === null) {
        user.email = undefined;
      } else {
        // Validate email if provided
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: 'Please enter a valid email address' });
        }
        user.email = email.trim().toLowerCase();
      }
    }
    if (businessName !== undefined) {
      user.businessName = businessName.trim() || '';
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
