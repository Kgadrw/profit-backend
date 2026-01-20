// Security Middleware
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';

// Rate limiting configurations
export const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs, // Time window in milliseconds
    max, // Maximum number of requests
    message: message || 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: message || 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
};

// General API rate limiter (100 requests per 15 minutes)
export const apiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100,
  'Too many API requests, please try again later.'
);

// Strict rate limiter for auth endpoints (5 requests per 15 minutes)
export const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5,
  'Too many login attempts, please try again later.'
);

// Strict rate limiter for admin endpoints (20 requests per minute)
export const adminLimiter = createRateLimiter(
  60 * 1000, // 1 minute
  20,
  'Too many admin requests, please try again later.'
);

// Security headers middleware
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow external resources if needed
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// Data sanitization middleware
export const sanitizeData = [
  // Prevent NoSQL injection attacks
  mongoSanitize(),
  // Prevent HTTP Parameter Pollution
  hpp()
];

// XSS protection is handled by:
// 1. Helmet's Content Security Policy
// 2. express-validator input validation
// 3. Frontend DOMPurify sanitization

// Request size limits
export const requestSizeLimit = {
  json: { limit: '10mb' },
  urlencoded: { limit: '10mb', extended: true }
};
