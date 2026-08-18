// Authentication Middleware
import User from '../models/User.js';
import mongoose from 'mongoose';

const USER_CACHE_TTL_MS = 15_000;
const USER_CACHE_MAX = 3000;
const userCache = new Map();

function readCachedUser(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

function writeCachedUser(userId, user) {
  if (userCache.size >= USER_CACHE_MAX) {
    const firstKey = userCache.keys().next().value;
    if (firstKey) userCache.delete(firstKey);
  }
  userCache.set(userId, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

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

    const cached = readCachedUser(userId);
    const user = cached || await User.findById(userId);
    if (!user) {
      return res.status(401).json({ 
        error: 'User not found. Please login again.' 
      });
    }

    if (!cached) writeCachedUser(userId, user);

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
    const userId = userIdRaw ? String(userIdRaw).trim() : null;

    if (!userId || userId !== 'admin') {
      console.error('[Admin Auth] ❌ FAILED:', {
        received: userId || 'missing',
        expected: 'admin',
        path: req.path,
        method: req.method,
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
        const cached = readCachedUser(userId);
        const user = cached || await User.findById(userId);
        if (user) {
          if (!cached) writeCachedUser(userId, user);
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
