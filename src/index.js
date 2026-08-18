// Backend API Entry Point
import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import compression from 'compression';
import apiRoutes from './routes/index.js';
import { connectDatabase } from './config/database.js';
import { trackApiRequest } from './middleware/apiTracker.js';
import { securityHeaders, sanitizeData, requestSizeLimit } from './middleware/security.js';
import { paypackWebhook } from './controllers/subscriptionController.js';
import { logPaypackStartupWarnings } from './utils/paypack.js';
import { startScheduler } from './utils/scheduler.js';
import { initializeWebSocket } from './utils/websocket.js';
import { migrateLegacyUploadsToDatabase } from './utils/migrateLegacyUploadsToDatabase.js';
import { startLoadManager, loadGuard, shouldSkipCompression } from './utils/loadManager.js';
import ServerStatus from './models/ServerStatus.js';

startLoadManager();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS) || 120_000;
server.timeout = Number(process.env.SOCKET_TIMEOUT_MS) || 120_000;
server.maxConnections = Number(process.env.MAX_CONNECTIONS) || 5000;

// Track server start time for uptime calculation
const serverStartTime = Date.now();

// Function to log server status (with error handling to prevent crashes)
const logServerStatus = async (status) => {
  try {
    // Only log if mongoose is connected
    const mongoose = await import('mongoose');
    if (mongoose.default.connection.readyState === 1) {
      await ServerStatus.create({
        status,
        timestamp: new Date(),
      });
    }
  } catch (error) {
    // Silently fail - don't crash the server if status logging fails
    console.error('Error logging server status (non-critical):', error.message);
  }
};

// When running behind a reverse proxy (e.g. Render, Nginx),
// trust the first proxy so Express and express-rate-limit
// can correctly use the X-Forwarded-* headers for IP detection.
app.set('trust proxy', 1);

// Connect to MongoDB
connectDatabase().then(async () => {
  try {
    const migration = await migrateLegacyUploadsToDatabase();
    if (migration.migrated > 0 || migration.urlsUpdated > 0) {
      console.log(
        `✅ Legacy uploads migrated to database: ${migration.migrated} file(s) imported, ${migration.urlsUpdated} URL(s) updated`,
      );
    }
  } catch (error) {
    console.error('Legacy upload migration failed (non-critical):', error.message);
  }

  // Log server startup (with delay to ensure DB is ready)
  setTimeout(async () => {
    await logServerStatus('up');
    console.log('✅ Server status tracking initialized');
  }, 1000);
}).catch((error) => {
  console.error('Failed to connect to database:', error);
  process.exit(1);
});

// Security Middleware (apply first)
app.use(securityHeaders);

// CORS configuration with security
// Allow all trippo.rw subdomains and localhost for development
const getAllowedOrigins = () => {
  const frontendUrl = process.env.FRONTEND_URL;
  
  // If FRONTEND_URL is explicitly set, use it
  if (frontendUrl && frontendUrl !== '*') {
    return frontendUrl;
  }
  
  // Default: Allow all trippo.rw subdomains and localhost
  // This includes: trippo.rw, admin.trippo.rw, bookfy.trippo.rw
  // And for local dev: localhost, admin.localhost, bookfy.localhost
  return (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    try {
      const originUrl = new URL(origin);
      const hostname = originUrl.hostname;
      
      // Allow all trippo.rw subdomains (http and https)
      if (hostname === 'trippo.rw' || 
          hostname.endsWith('.trippo.rw') ||
          hostname.includes('trippo.rw')) {
        return callback(null, true);
      }
      
      // Allow localhost for development (any port, http or https)
      if (hostname === 'localhost' || 
          hostname === '127.0.0.1' ||
          hostname.endsWith('.localhost')) {
        return callback(null, true);
      }
      
      // Allow any origin in development mode
      if (process.env.NODE_ENV === 'development') {
        return callback(null, true);
      }
      
      // Reject other origins in production
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    } catch (error) {
      // If URL parsing fails, allow in development, reject in production
      if (process.env.NODE_ENV === 'development') {
        return callback(null, true);
      }
      callback(new Error('Invalid origin'));
    }
  };
};

const corsOptions = {
  origin: getAllowedOrigins(),
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-Workspace-Mode', 'X-Workspace-Id', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Request-Id']
};
app.use(cors(corsOptions));

app.use(compression({
  threshold: 1024,
  level: 4,
  filter: (req, res) => {
    if (shouldSkipCompression()) return false;
    return compression.filter(req, res);
  },
}));

app.use(loadGuard);

// Paypack webhook — HEAD ping + POST payload (raw body for signature verification)
const paypackWebhookPath = '/api/subscription/webhook/paypack';

app.get(paypackWebhookPath, (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Paypack webhook endpoint is active. Paypack sends POST requests here.',
    path: paypackWebhookPath,
  });
});

app.head(paypackWebhookPath, paypackWebhook);
app.post(
  paypackWebhookPath,
  express.raw({ type: 'application/json', limit: requestSizeLimit.json.limit }),
  paypackWebhook,
);

// Body parsing with size limits
app.use(express.json(requestSizeLimit.json));
app.use(express.urlencoded(requestSizeLimit.urlencoded));

// Data sanitization (prevent NoSQL injection, XSS, etc.)
app.use(sanitizeData);

// Track API requests (apply to all routes)
app.use(trackApiRequest);

// Debug middleware: Log all incoming requests (only in development)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.path} - Headers:`, {
      'x-user-id': req.headers['x-user-id'] || 'missing',
      'content-type': req.headers['content-type'] || 'missing'
    });
    next();
  });
}

// API Routes
app.use('/api', apiRoutes);

// Debug: Log all registered routes (only in development)
if (process.env.NODE_ENV === 'development') {
  console.log('📋 Registered API routes:');
  console.log('  - GET    /api/products');
  console.log('  - POST   /api/products');
  console.log('  - GET    /api/sales');
  console.log('  - POST   /api/sales');
  console.log('  - GET    /api/inventories');
  console.log('  - POST   /api/inventories');
  console.log('  - GET    /api/schedules');
  console.log('  - POST   /api/schedules');
  console.log('  - GET    /api/bookings');
  console.log('  - POST   /api/bookings');
  console.log('  - GET    /api/clients');
  console.log('  - POST   /api/clients');
  console.log('  - GET    /api/services');
  console.log('  - POST   /api/auth/login');
  console.log('  - POST   /api/auth/register');
  console.log('  - GET    /api/admin/*');
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Profit Pilot Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      products: '/api/products'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler - log the requested path for debugging
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method,
    availableEndpoints: [
      '/api/products',
      '/api/sales',
      '/api/schedules',
      '/api/bookings',
      '/api/clients',
      '/api/services',
      '/api/auth/login',
      '/api/auth/register',
      '/api/subscription/webhook/paypack',
      '/api/admin/*'
    ]
  });
});

// Error handler (security: don't leak sensitive information)
app.use((err, req, res, next) => {
  // Log full error for debugging (server-side only)
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method
  });
  
  // Don't expose internal error details to client
  const statusCode = err.statusCode || err.status || 500;
  const message = statusCode === 500 
    ? 'An internal server error occurred. Please try again later.' 
    : (err.message || 'Something went wrong!');
  
  res.status(statusCode).json({ 
    error: message,
    ...(process.env.NODE_ENV === 'development' && { details: err.message })
  });
});

// Periodic server status logging (every 5 minutes)
let statusCheckInterval;
const startStatusTracking = async () => {
  // Wait a bit for DB to be fully ready
  setTimeout(() => {
    // Log status every 5 minutes
    statusCheckInterval = setInterval(async () => {
      await logServerStatus('up');
    }, 5 * 60 * 1000); // 5 minutes
  }, 2000);
};

// Graceful shutdown - log server down
const gracefulShutdown = async () => {
  console.log('🛑 Server shutting down...');
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }
  // Try to log shutdown, but don't wait if DB is disconnected
  try {
    await Promise.race([
      logServerStatus('down'),
      new Promise(resolve => setTimeout(resolve, 1000)) // Timeout after 1 second
    ]);
  } catch (error) {
    // Ignore errors during shutdown
  }
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Initialize WebSocket server
initializeWebSocket(server);

// Start HTTP server
server.listen(PORT, async () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📋 API endpoints available at http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket server available at ws://localhost:${PORT}/ws`);
  console.log(`🛡️ Load guard: max ${process.env.MAX_CONCURRENT_REQUESTS || 250} in-flight requests, ${server.maxConnections} sockets`);
  logPaypackStartupWarnings();

  // Start schedule notification scheduler
  startScheduler();
  
  // Start status tracking
  await startStatusTracking();
});
