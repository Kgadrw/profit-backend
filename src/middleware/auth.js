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
    // Express normalizes headers to lowercase, so 'x-user-id' should work
    // But check both cases and also check raw headers for safety
    const userIdRaw = req.headers['x-user-id'] || req.headers['X-User-Id'];
    // Trim whitespace in case there's any
    const userId = userIdRaw ? String(userIdRaw).trim() : null;
    
    // Always log admin auth attempts for debugging
    console.log('[Admin Auth] Attempt:', {
      'x-user-id': req.headers['x-user-id'],
      'X-User-Id': req.headers['X-User-Id'],
      'userId-raw': userIdRaw,
      'userId-trimmed': userId,
      'all-headers': Object.keys(req.headers).filter(k => k.toLowerCase().includes('user')),
      'all-header-values': Object.entries(req.headers)
        .filter(([k]) => k.toLowerCase().includes('user'))
        .map(([k, v]) => `${k}: ${v}`),
      path: req.path,
      method: req.method,
      origin: req.headers.origin,
      referer: req.headers.referer
    });
    
    // Check if userId is exactly 'admin' (case-sensitive, trimmed)
    if (!userId || userId !== 'admin') {
      console.error('[Admin Auth] ❌ FAILED:', {
        received: userId || 'missing',
        expected: 'admin',
        path: req.path,
        method: req.method,
        'header-exists': !!req.headers['x-user-id'],
        'header-value': req.headers['x-user-id']
      });
      return res.status(403).json({ 
        error: 'Admin access required. Unauthorized.',
        received: userId || 'missing',
        expected: 'admin',
        path: req.path,
        debug: process.env.NODE_ENV === 'development' ? {
          headers: Object.keys(req.headers).filter(k => k.toLowerCase().includes('user')),
          origin: req.headers.origin
        } : undefined
      });
    }

    console.log('[Admin Auth] ✅ SUCCESS - Admin authenticated');
    req.user = { _id: 'admin', isAdmin: true };
    next();
  } catch (error) {
    console.error('[Admin Auth] ❌ ERROR:', error);
    res.status(500).json({ 
      error: 'Admin authentication failed.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
