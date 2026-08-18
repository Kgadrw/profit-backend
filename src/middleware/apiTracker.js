// API Request Tracker Middleware
// Ring buffer keeps CPU/memory bounded under high traffic.

import { isOverloaded } from '../utils/loadManager.js';

const MAX_LOG_SIZE = 8000;
const apiRequestLog = new Array(MAX_LOG_SIZE);
let logHead = 0;
let logSize = 0;

function appendLog(entry) {
  apiRequestLog[logHead] = entry;
  logHead = (logHead + 1) % MAX_LOG_SIZE;
  if (logSize < MAX_LOG_SIZE) logSize += 1;
}

function forEachLog(fn) {
  const start = logSize < MAX_LOG_SIZE ? 0 : logHead;
  for (let i = 0; i < logSize; i += 1) {
    const item = apiRequestLog[(start + i) % MAX_LOG_SIZE];
    if (item) fn(item);
  }
}

function getRecentSlice(limit) {
  const n = Math.min(limit, logSize);
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    const idx = (logHead - i + MAX_LOG_SIZE) % MAX_LOG_SIZE;
    if (apiRequestLog[idx]) out.push(apiRequestLog[idx]);
  }
  return out;
}

function shouldSkipTracking(req) {
  const path = req.path || '';
  if (path === '/health' || path === '/') return true;
  if (isOverloaded() && Math.random() > 0.25) return true;
  return false;
}

export const trackApiRequest = (req, res, next) => {
  if (shouldSkipTracking(req)) return next();

  const startTime = Date.now();
  const requestInfo = {
    id: `${startTime}-${Math.random().toString(36).slice(2, 9)}`,
    method: req.method,
    path: req.path,
    endpoint: `${req.method} ${req.path}`,
    timestamp: new Date(),
    userAgent: req.get('user-agent') || 'Unknown',
    ip: req.ip || req.socket?.remoteAddress || 'Unknown',
    statusCode: null,
    responseTime: null,
  };

  const originalSend = res.send;
  res.send = function trackedSend(data) {
    requestInfo.statusCode = res.statusCode;
    requestInfo.responseTime = Date.now() - startTime;
    appendLog(requestInfo);
    return originalSend.call(this, data);
  };

  next();
};

export const getApiRequestStats = () => {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const oneDayAgo = now - (24 * 60 * 60 * 1000);

  const recentRequests = [];
  const dailyRequests = [];

  forEachLog((req) => {
    const time = new Date(req.timestamp).getTime();
    if (time > oneDayAgo) dailyRequests.push(req);
    if (time > oneHourAgo) recentRequests.push(req);
  });

  const endpointStats = {};
  dailyRequests.forEach((req) => {
    const key = req.endpoint;
    if (!endpointStats[key]) {
      endpointStats[key] = {
        endpoint: key,
        count: 0,
        avgResponseTime: 0,
        totalResponseTime: 0,
        errors: 0,
      };
    }
    endpointStats[key].count += 1;
    endpointStats[key].totalResponseTime += req.responseTime || 0;
    if (req.statusCode >= 400) {
      endpointStats[key].errors += 1;
    }
  });

  Object.values(endpointStats).forEach((stat) => {
    stat.avgResponseTime = stat.count > 0
      ? Math.round(stat.totalResponseTime / stat.count)
      : 0;
  });

  const hourlyRequests = [];
  for (let i = 23; i >= 0; i -= 1) {
    const hourStart = new Date(now - (i * 60 * 60 * 1000));
    const hourEnd = i > 0 ? new Date(now - ((i - 1) * 60 * 60 * 1000)) : new Date(now);
    const hourRequests = dailyRequests.filter((req) => {
      const reqTime = new Date(req.timestamp).getTime();
      return reqTime >= hourStart.getTime() && reqTime < hourEnd.getTime();
    });
    const errors = hourRequests.filter((req) => req.statusCode >= 400).length;
    hourlyRequests.push({
      hour: hourStart.getHours(),
      count: hourRequests.length,
      errors,
      success: hourRequests.length - errors,
      timestamp: hourStart.toISOString(),
      label: `${hourStart.getHours().toString().padStart(2, '0')}:00`,
    });
  }

  const statusCodeDistribution = {};
  let clientErrors24h = 0;
  let serverErrors24h = 0;
  let totalErrors24h = 0;

  dailyRequests.forEach((req) => {
    const code = Math.floor(req.statusCode / 100) * 100;
    statusCodeDistribution[code] = (statusCodeDistribution[code] || 0) + 1;
    if (req.statusCode >= 500) {
      serverErrors24h += 1;
      totalErrors24h += 1;
    } else if (req.statusCode >= 400) {
      clientErrors24h += 1;
      totalErrors24h += 1;
    }
  });

  const endpointList = Object.values(endpointStats).sort((a, b) => b.count - a.count);
  const failingEndpoints = endpointList.filter((e) => e.errors > 0).length;
  const slowEndpoints = endpointList.filter((e) => e.avgResponseTime >= 2000).length;

  return {
    totalRequests: logSize,
    recentRequests: recentRequests.length,
    dailyRequests: dailyRequests.length,
    endpointStats: endpointList,
    hourlyRequests,
    statusCodeDistribution,
    avgResponseTime: dailyRequests.length > 0
      ? Math.round(dailyRequests.reduce((sum, req) => sum + (req.responseTime || 0), 0) / dailyRequests.length)
      : 0,
    errorSummary: {
      totalErrors24h,
      clientErrors24h,
      serverErrors24h,
      failingEndpoints,
      slowEndpoints,
    },
  };
};

const SLOW_RESPONSE_MS = 2000;

export const getRecentErrors = (limit = 50) => {
  const errors = [];
  forEachLog((req) => {
    if (req.statusCode >= 400) errors.push(req);
  });
  return errors.slice(-limit).reverse();
};

export const getEndpointHealth = (slowThresholdMs = SLOW_RESPONSE_MS) => {
  const { endpointStats } = getApiRequestStats();

  return endpointStats
    .map((stat) => {
      const errorRate = stat.count > 0
        ? Math.round((stat.errors / stat.count) * 1000) / 10
        : 0;
      const isSlow = stat.avgResponseTime >= slowThresholdMs;
      let status = 'healthy';

      if (stat.errors > 0 && (errorRate >= 10 || stat.errors >= 5)) {
        status = 'critical';
      } else if (stat.errors > 0 || isSlow) {
        status = 'degraded';
      }

      return {
        ...stat,
        errorRate,
        isSlow,
        status,
      };
    })
    .filter((stat) => stat.status !== 'healthy')
    .sort((a, b) => b.errors - a.errors || b.avgResponseTime - a.avgResponseTime);
};

export const getLiveApiRequests = (limit = 50) => getRecentSlice(limit);
