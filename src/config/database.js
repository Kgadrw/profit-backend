// Database Configuration
import dns from 'node:dns';
import mongoose from 'mongoose';
import 'dotenv/config';

const PUBLIC_DNS = ['8.8.8.8', '8.8.4.4', '1.1.1.1'];

function applyDnsServers(servers) {
  if (servers?.length) {
    dns.setServers(servers);
    console.log(`🌐 DNS servers: ${dns.getServers().join(', ')}`);
  }
}

function getDnsServersFromEnv() {
  const raw = process.env.DNS_SERVERS;
  if (!raw?.trim()) return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Use DNS_SERVERS from .env when system DNS cannot resolve Atlas SRV records
applyDnsServers(getDnsServersFromEnv());

function isDnsSrvError(error) {
  return (
    error?.code === 'ECONNREFUSED' &&
    (error?.syscall === 'querySrv' || String(error?.message).includes('querySrv'))
  );
}

function logConnectionHints(error) {
  console.error('❌ Database connection error:', error.message);
  if (isDnsSrvError(error)) {
    console.error('💡 DNS could not resolve MongoDB Atlas (querySrv failed). Try:');
    console.error('   1. Add to backend/.env: DNS_SERVERS=8.8.8.8,8.8.4.4');
    console.error('   2. Or set Windows DNS to 8.8.8.8 / 1.1.1.1 in network adapter settings');
    console.error('   3. Disable VPN/proxy if DNS is blocked');
    return;
  }
  console.error('💡 Please check:');
  console.error('   1. Username and password are correct');
  console.error('   2. MongoDB Atlas IP whitelist includes your current IP');
  console.error('   3. Database user has proper permissions');
}

const DB_USERNAME = process.env.DB_USERNAME;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_CLUSTER = process.env.DB_CLUSTER;
const DB_NAME = process.env.DB_NAME || 'profit-pilot';

const MONGODB_URI = process.env.MONGODB_URI || (() => {
  if (!DB_USERNAME || !DB_PASSWORD || !DB_CLUSTER) {
    throw new Error('Missing required MongoDB environment variables: DB_USERNAME, DB_PASSWORD, DB_CLUSTER');
  }
  const encodedPassword = encodeURIComponent(DB_PASSWORD);
  return `mongodb+srv://${DB_USERNAME}:${encodedPassword}@${DB_CLUSTER}/${DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;
})();

const connectOptions = {
  serverSelectionTimeoutMS: 10000,
};

export const connectDatabase = async () => {
  console.log('🔄 Attempting to connect to MongoDB...');

  try {
    const conn = await mongoose.connect(MONGODB_URI, connectOptions);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    const configuredDns = getDnsServersFromEnv();
    const canRetryWithPublicDns =
      isDnsSrvError(error) &&
      process.env.DNS_SERVERS_AUTO_FALLBACK !== 'false' &&
      !configuredDns;

    if (canRetryWithPublicDns) {
      console.warn('⚠️  DNS SRV lookup failed — retrying with public DNS...');
      applyDnsServers(PUBLIC_DNS);
      try {
        const conn = await mongoose.connect(MONGODB_URI, connectOptions);
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        console.log(`📊 Database: ${conn.connection.name}`);
        return conn;
      } catch (retryError) {
        logConnectionHints(retryError);
        throw retryError;
      }
    }

    logConnectionHints(error);
    throw error;
  }
};

mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB disconnected');
});

mongoose.connection.on('error', (error) => {
  console.error('❌ MongoDB connection error:', error);
});

export default mongoose;
