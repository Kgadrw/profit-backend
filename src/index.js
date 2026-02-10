// Backend API Entry Point
import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import apiRoutes from './routes/index.js';
import { connectDatabase } from './config/database.js';
import { trackApiRequest } from './middleware/apiTracker.js';
import { securityHeaders, sanitizeData, requestSizeLimit } from './middleware/security.js';
import { startScheduler } from './utils/scheduler.js';
import { initializeWebSocket } from './utils/websocket.js';
import ServerStatus from './models/ServerStatus.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

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
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*', // In production, specify exact frontend URL
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id']
};
app.use(cors(corsOptions));

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
  console.log('  - GET    /api/schedules');
  console.log('  - POST   /api/schedules');
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
      '/api/clients',
      '/api/services',
      '/api/auth/login',
      '/api/auth/register',
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

// Start server
server.listen(PORT, async () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📋 API endpoints available at http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket server available at ws://localhost:${PORT}/ws`);
  
  // Start schedule notification scheduler
  startScheduler();
  
  // Start status tracking
  await startStatusTracking();
});
