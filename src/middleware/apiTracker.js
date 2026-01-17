// API Request Tracker Middleware
// This middleware tracks all API requests for analytics

// In-memory storage for API request tracking
// In production, you'd want to use Redis or a database
const apiRequestLog = [];
const MAX_LOG_SIZE = 10000; // Keep last 10k requests

// Track API request
export const trackApiRequest = (req, res, next) => {
  const startTime = Date.now();
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Store request info
  const requestInfo = {
    id: requestId,
    method: req.method,
    path: req.path,
    endpoint: `${req.method} ${req.path}`,
    timestamp: new Date(),
    userAgent: req.get('user-agent') || 'Unknown',
    ip: req.ip || req.connection.remoteAddress || 'Unknown',
    statusCode: null,
    responseTime: null,
  };

  // Track response
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    requestInfo.statusCode = res.statusCode;
    requestInfo.responseTime = responseTime;
    
    // Add to log
    apiRequestLog.push(requestInfo);
    
    // Keep log size manageable
    if (apiRequestLog.length > MAX_LOG_SIZE) {
      apiRequestLog.shift(); // Remove oldest
    }
    
    return originalSend.call(this, data);
  };

  next();
};

// Get API request statistics
export const getApiRequestStats = () => {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  const recentRequests = apiRequestLog.filter(req => 
    new Date(req.timestamp).getTime() > oneHourAgo
  );
  
  const dailyRequests = apiRequestLog.filter(req => 
    new Date(req.timestamp).getTime() > oneDayAgo
  );

  // Group by endpoint
  const endpointStats = {};
  dailyRequests.forEach(req => {
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
    endpointStats[key].count++;
    endpointStats[key].totalResponseTime += req.responseTime || 0;
    if (req.statusCode >= 400) {
      endpointStats[key].errors++;
    }
  });

  // Calculate averages
  Object.values(endpointStats).forEach(stat => {
    stat.avgResponseTime = stat.count > 0 
      ? Math.round(stat.totalResponseTime / stat.count) 
      : 0;
  });

  // Get requests per hour (last 24 hours)
  const hourlyRequests = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = new Date(now - (i * 60 * 60 * 1000));
    const hourEnd = i > 0 ? new Date(now - ((i - 1) * 60 * 60 * 1000)) : new Date(now);
    const hourRequests = dailyRequests.filter(req => {
      const reqTime = new Date(req.timestamp).getTime();
      return reqTime >= hourStart.getTime() && reqTime < hourEnd.getTime();
    });
    hourlyRequests.push({
      hour: hourStart.getHours(),
      count: hourRequests.length,
      timestamp: hourStart.toISOString(),
      label: `${hourStart.getHours().toString().padStart(2, '0')}:00`,
    });
  }

  // Get status code distribution
  const statusCodeDistribution = {};
  dailyRequests.forEach(req => {
    const code = Math.floor(req.statusCode / 100) * 100; // Group by 100s
    statusCodeDistribution[code] = (statusCodeDistribution[code] || 0) + 1;
  });

  return {
    totalRequests: apiRequestLog.length,
    recentRequests: recentRequests.length, // Last hour
    dailyRequests: dailyRequests.length,
    endpointStats: Object.values(endpointStats).sort((a, b) => b.count - a.count),
    hourlyRequests,
    statusCodeDistribution,
    avgResponseTime: dailyRequests.length > 0
      ? Math.round(dailyRequests.reduce((sum, req) => sum + (req.responseTime || 0), 0) / dailyRequests.length)
      : 0,
  };
};

// Get live API requests (last N requests)
export const getLiveApiRequests = (limit = 50) => {
  return apiRequestLog.slice(-limit).reverse(); // Most recent first
};
