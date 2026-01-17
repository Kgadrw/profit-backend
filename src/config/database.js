// Database Configuration
import mongoose from 'mongoose';
import 'dotenv/config';

// MongoDB Atlas connection credentials from environment variables
const DB_USERNAME = process.env.DB_USERNAME;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_CLUSTER = process.env.DB_CLUSTER;
const DB_NAME = process.env.DB_NAME || 'profit-pilot';

// Build connection string from environment variables
// If MONGODB_URI is provided directly, use it; otherwise build from components
const MONGODB_URI = process.env.MONGODB_URI || (() => {
  if (!DB_USERNAME || !DB_PASSWORD || !DB_CLUSTER) {
    throw new Error('Missing required MongoDB environment variables: DB_USERNAME, DB_PASSWORD, DB_CLUSTER');
  }
  const encodedPassword = encodeURIComponent(DB_PASSWORD);
  return `mongodb+srv://${DB_USERNAME}:${encodedPassword}@${DB_CLUSTER}/${DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;
})();

export const connectDatabase = async () => {
  try {
    console.log('🔄 Attempting to connect to MongoDB...');
    const conn = await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    console.error('💡 Please check:');
    console.error('   1. Username and password are correct');
    console.error('   2. MongoDB Atlas IP whitelist includes your current IP');
    console.error('   3. Database user has proper permissions');
    throw error;
  }
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB disconnected');
});

mongoose.connection.on('error', (error) => {
  console.error('❌ MongoDB connection error:', error);
});

export default mongoose;
