// Process load manager — samples CPU / event-loop lag and sheds excess traffic
// so a single Node process stays responsive for thousands of concurrent users.
import os from 'os';
import { monitorEventLoopDelay } from 'perf_hooks';

const cores = Math.max(1, os.cpus()?.length || 1);
const MAX_CONCURRENT = Math.max(50, Number(process.env.MAX_CONCURRENT_REQUESTS) || 250);
const CPU_WARN = Number(process.env.CPU_WARN_PERCENT) || 70;
const CPU_HIGH = Number(process.env.CPU_HIGH_PERCENT) || 85;
const CPU_CRITICAL = Number(process.env.CPU_CRITICAL_PERCENT) || 95;
const LAG_WARN_MS = Number(process.env.EVENT_LOOP_WARN_MS) || 80;
const LAG_HIGH_MS = Number(process.env.EVENT_LOOP_HIGH_MS) || 150;
const LAG_CRITICAL_MS = Number(process.env.EVENT_LOOP_CRITICAL_MS) || 300;

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

let lastCpuUsage = process.cpuUsage();
let lastSampleAt = Date.now();
let cpuPercent = 0;
let eventLoopLagMs = 0;
let inFlight = 0;
let peakInFlight = 0;
let shedCount = 0;
let sampleTimer = null;

function clampPercent(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(100, Math.round(value * 10) / 10);
}

function sampleLoad() {
  const now = Date.now();
  const wallMs = Math.max(1, now - lastSampleAt);
  lastSampleAt = now;
  const diff = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  const cpuMs = (diff.user + diff.system) / 1000;
  // cpuMs can exceed wall time on multi-core; normalize to 0–100 of the machine.
  const oneCorePercent = (cpuMs / wallMs) * 100;
  cpuPercent = clampPercent(oneCorePercent / cores);

  eventLoopLagMs = Math.round((histogram.mean || 0) / 1e6);
  histogram.reset();
}

export function startLoadManager() {
  if (sampleTimer) return;
  sampleLoad();
  sampleTimer = setInterval(sampleLoad, 2000);
  if (typeof sampleTimer.unref === 'function') sampleTimer.unref();
}

export function getLoadLevel() {
  if (cpuPercent >= CPU_CRITICAL || eventLoopLagMs >= LAG_CRITICAL_MS || inFlight >= MAX_CONCURRENT) {
    return 'critical';
  }
  if (cpuPercent >= CPU_HIGH || eventLoopLagMs >= LAG_HIGH_MS || inFlight >= MAX_CONCURRENT * 0.8) {
    return 'high';
  }
  if (cpuPercent >= CPU_WARN || eventLoopLagMs >= LAG_WARN_MS || inFlight >= MAX_CONCURRENT * 0.55) {
    return 'elevated';
  }
  return 'normal';
}

export function isOverloaded() {
  const level = getLoadLevel();
  return level === 'high' || level === 'critical';
}

export function getLoadSnapshot() {
  const mem = process.memoryUsage();
  const level = getLoadLevel();
  return {
    cpuPercent,
    cores,
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    eventLoopLagMs,
    level,
    protecting: level === 'high' || level === 'critical',
    inFlight,
    peakInFlight,
    maxConcurrent: MAX_CONCURRENT,
    shedCount,
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      externalMb: Math.round((mem.external || 0) / 1024 / 1024),
    },
    pid: process.pid,
    nodeVersion: process.version,
  };
}

function isAlwaysAllow(req) {
  if (req.method === 'OPTIONS') return true;
  const url = req.originalUrl || req.url || '';
  if (url === '/health' || url.startsWith('/health?')) return true;
  if (url.startsWith('/api/admin/health')) return true;
  if (url.includes('/webhook')) return true;
  if (url.startsWith('/api/subscription/webhook')) return true;
  return false;
}

function isPriorityPath(req) {
  const url = req.originalUrl || req.url || '';
  if (url.startsWith('/api/auth')) return true;
  if (url.startsWith('/api/admin')) return true;
  if (url.startsWith('/api/subscription')) return true;
  if (url.startsWith('/api/notifications')) return true;
  if (req.method !== 'GET' && req.method !== 'HEAD') return true;
  return false;
}

function isDeferableGet(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const url = req.originalUrl || req.url || '';
  return (
    url.startsWith('/api/ai')
    || url.startsWith('/api/greetings')
    || url.startsWith('/api/greeting')
    || url.startsWith('/api/content')
    || url.startsWith('/api/admin/api-stats')
    || url.startsWith('/api/admin/activity')
    || url.startsWith('/api/admin/usage')
  );
}

function busyResponse(res, retryAfter, level) {
  shedCount += 1;
  res.set('Retry-After', String(retryAfter));
  res.set('X-Load-Level', level);
  return res.status(503).json({
    error: 'Server is busy protecting live traffic. Please retry shortly.',
    retryAfter,
    loadLevel: level,
  });
}

function trackInFlight(res) {
  inFlight += 1;
  if (inFlight > peakInFlight) peakInFlight = inFlight;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight = Math.max(0, inFlight - 1);
  };
  res.on('finish', release);
  res.on('close', release);
}

export function loadGuard(req, res, next) {
  if (isAlwaysAllow(req)) {
    trackInFlight(res);
    return next();
  }

  const level = getLoadLevel();

  if (inFlight >= MAX_CONCURRENT && !isPriorityPath(req)) {
    return busyResponse(res, 1, level);
  }

  if (level === 'critical' && isDeferableGet(req)) {
    return busyResponse(res, 2, level);
  }

  if (level === 'high' && isDeferableGet(req)) {
    return busyResponse(res, 1, level);
  }

  if (inFlight >= MAX_CONCURRENT * 1.15) {
    return busyResponse(res, 2, level);
  }

  trackInFlight(res);
  next();
}

export function shouldSkipBackgroundJobs() {
  return isOverloaded();
}

export function shouldSkipCompression() {
  return getLoadLevel() === 'critical' || eventLoopLagMs >= LAG_CRITICAL_MS;
}
