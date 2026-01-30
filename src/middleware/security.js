// Security Middleware
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import { rateLimiters } from './rateLimiter.js';

// Export rate limiters for backward compatibility
export const apiLimiter = rateLimiters.general;
export const authLimiter = rateLimiters.auth;
export const adminLimiter = rateLimiters.admin;

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
