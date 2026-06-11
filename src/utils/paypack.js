import crypto from 'crypto';

const BASE_URL = (process.env.PAYPACK_BASE_URL || 'https://payments.paypack.rw/api').replace(/\/$/, '');
const CLIENT_ID = process.env.PAYPACK_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PAYPACK_CLIENT_SECRET || '';
const WEBHOOK_MODE = process.env.PAYPACK_WEBHOOK_MODE || 'development';
const WEBHOOK_SIGN_KEY = process.env.PAYPACK_WEBHOOK_SIGN_KEY || '';

let tokenCache = { access: null, refresh: null, expiresAt: 0 };

export function isPaypackConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function isMockPaymentsEnabled() {
  return process.env.SUBSCRIPTION_MOCK_PAYMENTS === 'true';
}

export function isPaymentConfigured() {
  return isPaypackConfigured() || isMockPaymentsEnabled();
}

export function getPaymentPublicConfig() {
  const mock = isMockPaymentsEnabled();
  return {
    configured: isPaypackConfigured() || mock,
    mock,
    provider: 'paypack',
    currency: 'RWF',
    amount: Number(process.env.SUBSCRIPTION_AMOUNT || 10000),
    displayCurrency: 'RWF',
    webhookMode: WEBHOOK_MODE,
  };
}

/** Rwanda mobile money number in 078xxxxxxx format for Paypack */
export function normalizePhoneNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('250') && digits.length >= 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith('0') && digits.length === 10) return digits;
  if (digits.length === 9) return `0${digits}`;
  return digits;
}

/** Validate Rwanda MTN / Airtel MoMo numbers for subscription payments. */
export function validateRwandaMobileNumber(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) {
    return { valid: false, normalized: '', network: null, error: 'Phone number is required.' };
  }
  if (!/^0(78|79|72|73)\d{7}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      network: null,
      error: 'Use a valid Rwanda mobile money number (MTN 078/079 or Airtel 072/073).',
    };
  }
  const network = /^0(78|79)/.test(normalized) ? 'mtn' : 'airtel';
  return { valid: true, normalized, network, error: null };
}

function parseExpires(expires) {
  if (!expires) return Date.now() + 14 * 60 * 1000;
  const parsed = new Date(expires).getTime();
  if (!Number.isNaN(parsed)) return parsed - 60 * 1000;
  return Date.now() + 14 * 60 * 1000;
}

async function paypackFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!res.ok) {
    const message = body?.message || body?.error || text || `Paypack API error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function getAccessToken() {
  if (!isPaypackConfigured()) {
    throw new Error('Paypack is not configured. Set PAYPACK_CLIENT_ID and PAYPACK_CLIENT_SECRET.');
  }

  if (tokenCache.access && Date.now() < tokenCache.expiresAt) {
    return tokenCache.access;
  }

  if (tokenCache.refresh) {
    try {
      const refreshed = await paypackFetch(`/auth/agents/refresh/${tokenCache.refresh}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      tokenCache = {
        access: refreshed.access,
        refresh: refreshed.refresh || tokenCache.refresh,
        expiresAt: parseExpires(refreshed.expires),
      };
      return tokenCache.access;
    } catch {
      // Re-authorize below
    }
  }

  const body = await paypackFetch('/auth/agents/authorize', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  tokenCache = {
    access: body.access,
    refresh: body.refresh,
    expiresAt: parseExpires(body.expires),
  };
  return tokenCache.access;
}

export async function cashin({ amount, number, idempotencyKey }) {
  const token = await getAccessToken();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Webhook-Mode': WEBHOOK_MODE,
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 32);
  }

  const body = await paypackFetch('/transactions/cashin', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amount: Number(amount),
      number: String(number),
    }),
  });

  return body?.ref ? body : body?.data?.ref ? body.data : body;
}

export async function findTransaction(ref) {
  const token = await getAccessToken();
  return paypackFetch(`/transactions/find/${encodeURIComponent(ref)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
}

function getEventKind(event) {
  return event?.event_kind || event?.['event-kind'] || '';
}

function getRootEventKind(payload) {
  return payload?.['event-kind'] || payload?.event_kind || '';
}

async function paypackGet(path, queryParams = {}) {
  const token = await getAccessToken();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null && String(value) !== '') {
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  return paypackFetch(`${path}${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * List Paypack transaction events — see https://docs.paypack.rw/quickstart/events
 * Query: ref, client, kind (CASHIN|CASHOUT), status (pending|successful|failed)
 */
export async function findTransactionEvents({ ref, client, kind = 'CASHIN', status } = {}) {
  const params = { kind };
  if (ref) params.ref = String(ref);
  if (client) params.client = normalizePhoneNumber(client);
  if (status) params.status = status;
  return paypackGet('/events/transactions', params);
}

export async function findTransactionEventsByClient(client) {
  return findTransactionEvents({ client, kind: 'CASHIN' });
}

/** Successful cashins for a phone — events API with status=successful filter. */
export async function listProcessedCashins(client) {
  return findTransactionEvents({ client, kind: 'CASHIN', status: 'successful' });
}

/** Try multiple event queries (ref+client, ref only, client+successful, client all). */
export async function fetchTransactionEventSnapshots(payment) {
  const snapshots = [];
  const queries = [
    { ref: payment.referenceId, client: payment.msisdn, kind: 'CASHIN' },
    { ref: payment.referenceId, kind: 'CASHIN' },
    { client: payment.msisdn, kind: 'CASHIN', status: 'successful' },
    { client: payment.msisdn, kind: 'CASHIN' },
  ];

  for (const query of queries) {
    try {
      snapshots.push(await findTransactionEvents(query));
    } catch (error) {
      // try next query shape
    }
  }

  return snapshots;
}

function flattenPaypackRows(payload) {
  const rows = [];
  const items = Array.isArray(payload?.transactions) ? payload.transactions : [];

  for (const item of items) {
    if (getEventKind(item) !== 'transaction:processed' || !item?.data?.status) continue;

    rows.push({
      ref: item.data.ref || payload?.ref,
      status: item.data.status,
      amount: item.data.amount ?? payload?.amount,
      client: item.data.client || payload?.client,
      at: item.data.processed_at || item.data.created_at || item.created_at,
    });
  }

  return rows;
}

/**
 * Match a local pending payment to a successful Paypack transaction.
 * Prefers exact ref; fallback is phone+amount+time only when ref is absent or matches this payment.
 */
export function findMatchingSuccessfulTransaction(payment, payload, { blockedRefs = new Set() } = {}) {
  const rows = flattenPaypackRows(payload);
  if (!rows.length) return null;

  const paymentMs = new Date(payment.createdAt || Date.now()).getTime();
  const windowMs = 30 * 60 * 1000;
  const msisdn = normalizePhoneNumber(payment.msisdn);

  const matches = rows.filter((row) => {
    if (mapPaypackStatus(row.status) !== 'SUCCESSFUL') return false;
    if (row.ref && blockedRefs.has(row.ref)) return false;

    if (row.ref && row.ref === payment.referenceId) return true;

    // Phone+amount fallback: only when Paypack row has no ref or ref is not claimed elsewhere
    if (row.ref && row.ref !== payment.referenceId) return false;

    const amountMatch = Number(row.amount) === Number(payment.amount);
    const phoneMatch = !row.client || normalizePhoneNumber(row.client) === msisdn;
    const atMs = row.at ? new Date(row.at).getTime() : paymentMs;
    const timeMatch = Math.abs(atMs - paymentMs) <= windowMs;
    return amountMatch && phoneMatch && timeMatch;
  });

  if (!matches.length) return null;

  return matches.sort((a, b) => {
    const aExactRef = a.ref === payment.referenceId ? 1 : 0;
    const bExactRef = b.ref === payment.referenceId ? 1 : 0;
    if (bExactRef !== aExactRef) return bExactRef - aExactRef;
    const aTime = a.at ? new Date(a.at).getTime() : 0;
    const bTime = b.at ? new Date(b.at).getTime() : 0;
    return Math.abs(aTime - paymentMs) - Math.abs(bTime - paymentMs);
  })[0];
}

function refsMatch(expectedRef, dataRef, rootRef) {
  if (!expectedRef) return true;
  if (dataRef === expectedRef) return true;
  // Root ref matches only when processed data ref is absent or agrees
  if (rootRef === expectedRef && (!dataRef || dataRef === rootRef)) return true;
  return false;
}

/**
 * Parse Paypack /events/transactions response.
 * Only transaction:processed → data.status is authoritative.
 * Root-level "status" is a query echo — never use it as payment result.
 */
export function extractPaypackStatusFromEvents(eventsPayload, expectedRef = null) {
  if (!eventsPayload || typeof eventsPayload !== 'object') return null;

  const rootRef = eventsPayload.ref || null;
  const rootEventKind = getRootEventKind(eventsPayload);
  const transactions = Array.isArray(eventsPayload.transactions) ? eventsPayload.transactions : [];

  const processed = transactions
    .filter((event) => getEventKind(event) === 'transaction:processed' && event?.data?.status)
    .filter((event) => refsMatch(expectedRef, event.data.ref, rootRef))
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  if (processed.length > 0) {
    const latest = processed[processed.length - 1];
    return {
      status: latest.data.status,
      fromProcessed: true,
      ref: latest.data.ref || rootRef,
    };
  }

  const awaitingCustomer =
    rootEventKind === 'transaction:created' ||
    transactions.some((event) => getEventKind(event) === 'transaction:created');

  if (awaitingCustomer && refsMatch(expectedRef, rootRef, rootRef)) {
    return { status: 'pending', fromProcessed: false, ref: rootRef };
  }

  return null;
}

/** Merge multiple event API responses — always prefer successful over failed. */
export function extractPaypackStatusFromEventSnapshots(snapshots, expectedRef = null) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;

  let pending = null;
  let failed = null;

  for (const snapshot of snapshots) {
    const parsed = extractPaypackStatusFromEvents(snapshot, expectedRef);
    if (!parsed) continue;

    if (!parsed.fromProcessed) {
      pending = pending || parsed;
      continue;
    }

    const mapped = mapPaypackStatus(parsed.status);
    if (mapped === 'SUCCESSFUL') return parsed;
    if (mapped === 'FAILED') failed = parsed;
  }

  if (pending) return pending;
  return failed;
}

export function mapPaypackStatus(status) {
  const normalized = String(status || '').toLowerCase().trim();
  if (normalized === 'successful' || normalized === 'success') return 'SUCCESSFUL';
  if (['failed', 'declined', 'rejected', 'cancelled', 'canceled', 'timeout'].includes(normalized)) {
    return 'FAILED';
  }
  return 'PENDING';
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SIGN_KEY) return true;
  if (!signature) return false;
  const buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const hash = crypto.createHmac('sha256', WEBHOOK_SIGN_KEY).update(buffer).digest('base64');
  return hash === signature;
}

export function generateIdempotencyKey() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
}
