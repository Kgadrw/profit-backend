// Backend API Entry Point
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';
import { connectDatabase } from './config/database.js';
import { trackApiRequest } from './middleware/apiTracker.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Track server start time for uptime calculation
const serverStartTime = Date.now();

// Connect to MongoDB
connectDatabase().catch((error) => {
  console.error('Failed to connect to database:', error);
  process.exit(1);
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📋 API endpoints available at http://localhost:${PORT}/api`);
});
