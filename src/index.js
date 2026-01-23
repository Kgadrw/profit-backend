// Backend API Entry Point
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';
import { connectDatabase } from './config/database.js';
import { trackApiRequest } from './middleware/apiTracker.js';
import { securityHeaders, sanitizeData, requestSizeLimit } from './middleware/security.js';
import { startScheduler } from './utils/scheduler.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Track server start time for uptime calculation
const serverStartTime = Date.now();

// Connect to MongoDB
connectDatabase().catch((error) => {
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

// API Routes
app.use('/api', apiRoutes);

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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📋 API endpoints available at http://localhost:${PORT}/api`);
  
  // Start schedule notification scheduler
  startScheduler();
});
