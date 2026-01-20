// Authentication Middleware
import User from '../models/User.js';
import mongoose from 'mongoose';

// Verify user authentication via X-User-Id header
export const authenticateUser = async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'Authentication required. Please login first.' 
      });
    }

    // Check if it's admin
    if (userId === 'admin') {
      req.user = { _id: 'admin', isAdmin: true };
      return next();
    }

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ 
        error: 'Invalid user ID format. Please login again.' 
      });
    }

    // Verify user exists in database
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ 
        error: 'User not found. Please login again.' 
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ 
      error: 'Authentication failed. Please try again.' 
    });
  }
};

// Verify admin access
export const authenticateAdmin = async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    
    if (!userId || userId !== 'admin') {
      return res.status(403).json({ 
        error: 'Admin access required. Unauthorized.' 
      });
    }

    req.user = { _id: 'admin', isAdmin: true };
    next();
  } catch (error) {
    console.error('Admin authentication error:', error);
    res.status(500).json({ 
      error: 'Admin authentication failed.' 
    });
  }
};

// Optional authentication (for endpoints that work with or without auth)
export const optionalAuth = async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    
    if (userId) {
      if (userId === 'admin') {
        req.user = { _id: 'admin', isAdmin: true };
      } else if (mongoose.Types.ObjectId.isValid(userId)) {
        const user = await User.findById(userId);
        if (user) {
          req.user = user;
        }
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication if there's an error
    next();
  }
};
