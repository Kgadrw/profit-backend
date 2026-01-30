// Smart Rate Limiting Middleware
import rateLimit from 'express-rate-limit';

// Optional Redis support (will fall back to memory if not available)
let redisClient = null;
let useRedis = false;

// Try to connect to Redis for distributed rate limiting (optional)
(async () => {
  try {
    if (process.env.REDIS_URL) {
      // Dynamic import to avoid requiring redis as a dependency
      const { createClient } = await import('redis');
      redisClient = createClient({ url: process.env.REDIS_URL });
      await redisClient.connect();
      useRedis = true;
      console.log('✅ Redis connected for rate limiting');
    }
  } catch (error) {
    // Redis is optional - fall back to in-memory store
    console.warn('⚠️ Redis not available, using in-memory rate limiting:', error.message);
    useRedis = false;
  }
})();

// Custom store for rate limiting (supports both Redis and memory)
class CustomStore {
  constructor() {
    this.memoryStore = new Map();
  }

  async increment(key) {
    if (useRedis && redisClient) {
      try {
        const count = await redisClient.incr(key);
        // Set expiration if this is the first request
        if (count === 1) {
          await redisClient.expire(key, 900); // 15 minutes
        }
        return { totalHits: count, resetTime: new Date(Date.now() + 900000) };
      } catch (error) {
        console.warn('Redis error, falling back to memory:', error.message);
        useRedis = false;
      }
    }
    
    // Fallback to memory store
    const now = Date.now();
    const entry = this.memoryStore.get(key) || { count: 0, resetTime: now + 900000 };
    
    if (now > entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + 900000; // 15 minutes
    }
    
    entry.count++;
    this.memoryStore.set(key, entry);
    
    return { totalHits: entry.count, resetTime: new Date(entry.resetTime) };
  }

  async decrement(key) {
    if (useRedis && redisClient) {
      try {
        await redisClient.decr(key);
        return;
      } catch (error) {
        // Fallback to memory
      }
    }
    
    const entry = this.memoryStore.get(key);
    if (entry && entry.count > 0) {
      entry.count--;
      this.memoryStore.set(key, entry);
    }
  }

  async resetKey(key) {
    if (useRedis && redisClient) {
      try {
        await redisClient.del(key);
        return;
      } catch (error) {
        // Fallback to memory
      }
    }
    
    this.memoryStore.delete(key);
  }

  async shutdown() {
    if (redisClient) {
      await redisClient.quit();
    }
  }
}

const customStore = new CustomStore();

// Generate rate limit key based on user ID or IP
const generateKey = (req) => {
  const userId = req.headers['x-user-id'] || req.user?.id;
  const ip = req.ip || req.connection.remoteAddress;
  
  // Use userId if available, otherwise fall back to IP
  return userId ? `rate-limit:user:${userId}` : `rate-limit:ip:${ip}`;
};

// Create rate limiter with custom configuration
export const createSmartRateLimiter = (options) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    max = 100, // Max requests
    message = 'Too many requests, please try again later.',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    route = 'general'
  } = options;

  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    store: customStore,
    keyGenerator: generateKey,
    skip: (req) => {
      // Skip rate limiting for health checks
      if (req.path === '/health' || req.path === '/api/health') {
        return true;
      }
      return false;
    },
    handler: (req, res) => {
      const resetTime = res.get('X-RateLimit-Reset');
      const retryAfter = resetTime ? Math.ceil((new Date(resetTime).getTime() - Date.now()) / 1000) : Math.ceil(windowMs / 1000);
      
      res.status(429).json({
        error: message,
        retryAfter,
        limit: max,
        window: Math.ceil(windowMs / 1000), // in seconds
        route
      });
    },
    skipSuccessfulRequests,
    skipFailedRequests
  });
};

// Route-specific rate limiters
export const rateLimiters = {
  // Auth endpoints: strict (5 requests per 15 minutes)
  auth: createSmartRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts. Please try again later.',
    route: 'auth'
  }),

  // OTP/Password reset: very strict (3 requests per 15 minutes)
  otp: createSmartRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: 'Too many OTP requests. Please try again later.',
    route: 'otp'
  }),

  // Products: moderate (200 requests per 15 minutes)
  products: createSmartRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: 'Too many product requests. Please try again later.',
    route: 'products'
  }),

  // Sales: moderate (200 requests per 15 minutes)
  sales: createSmartRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: 'Too many sales requests. Please try again later.',
    route: 'sales'
  }),

  // General API: standard (100 requests per 15 minutes)
  general: createSmartRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many API requests. Please try again later.',
    route: 'general'
  }),

  // Admin: higher limit (300 requests per minute)
  admin: createSmartRateLimiter({
    windowMs: 60 * 1000,
    max: 300,
    message: 'Too many admin requests. Please try again later.',
    route: 'admin'
  })
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  await customStore.shutdown();
});

process.on('SIGINT', async () => {
  await customStore.shutdown();
});
