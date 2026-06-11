import crypto from 'crypto';

const BASE_URL = (process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com').replace(/\/$/, '');
const SUBSCRIPTION_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY || '';
const API_USER = process.env.MTN_MOMO_API_USER || '';
const API_KEY = process.env.MTN_MOMO_API_KEY || '';
const TARGET_ENV = process.env.MTN_MOMO_TARGET_ENV || 'sandbox';
const CALLBACK_URL = process.env.MTN_MOMO_CALLBACK_URL || '';
const CURRENCY = process.env.MTN_MOMO_CURRENCY || 'RWF';

let tokenCache = { token: null, expiresAt: 0 };

export function isMtnConfigured() {
  return Boolean(SUBSCRIPTION_KEY && API_USER && API_KEY);
}

/** Simulate MoMo payments locally when API credentials are not available yet. */
export function isMockPaymentsEnabled() {
  return process.env.SUBSCRIPTION_MOCK_PAYMENTS === 'true';
}

export function getMtnPublicConfig() {
  const mock = isMockPaymentsEnabled();
  return {
    configured: isMtnConfigured() || mock,
    mock,
    targetEnvironment: TARGET_ENV,
    currency: CURRENCY,
    sandbox: TARGET_ENV === 'sandbox',
    amount: Number(process.env.SUBSCRIPTION_AMOUNT || 5000),
    displayCurrency: 'RWF',
  };
}

export function generateReferenceId() {
  return crypto.randomUUID();
}

/** Rwanda / regional MSISDN — sandbox may require test numbers like 46733123454 */
export function normalizeMsisdn(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (TARGET_ENV === 'sandbox' && process.env.MTN_MOMO_SANDBOX_MSISDN) {
    return process.env.MTN_MOMO_SANDBOX_MSISDN.replace(/\D/g, '');
  }

  if (digits.startsWith('250')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `250${digits.slice(1)}`;
  if (digits.length === 9) return `250${digits}`;
  return digits;
}

async function mtnFetch(path, options = {}) {
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
    const message = body?.message || body?.error || text || `MTN API error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function getAccessToken() {
  if (!isMtnConfigured()) {
    throw new Error('MTN MoMo is not configured. Set MTN_MOMO_SUBSCRIPTION_KEY, MTN_MOMO_API_USER, and MTN_MOMO_API_KEY.');
  }

  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(`${API_USER}:${API_KEY}`).toString('base64');
  const body = await mtnFetch('/collection/token/', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
    },
  });

  const expiresIn = Number(body?.expires_in || 3600);
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  return tokenCache.token;
}

export async function requestToPay({ referenceId, amount, msisdn, externalId, payerMessage, payeeNote }) {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Reference-Id': referenceId,
    'X-Target-Environment': TARGET_ENV,
    'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
    'Content-Type': 'application/json',
  };
  if (CALLBACK_URL) headers['X-Callback-Url'] = CALLBACK_URL;

  await mtnFetch('/collection/v1_0/requesttopay', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amount: String(amount),
      currency: CURRENCY,
      externalId: String(externalId),
      payer: {
        partyIdType: 'MSISDN',
        partyId: msisdn,
      },
      payerMessage: payerMessage || 'Trippo subscription',
      payeeNote: payeeNote || 'Trippo monthly subscription',
    }),
  });

  return { referenceId, status: 'PENDING' };
}

export async function getRequestToPayStatus(referenceId) {
  const token = await getAccessToken();
  return mtnFetch(`/collection/v1_0/requesttopay/${referenceId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Target-Environment': TARGET_ENV,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
    },
  });
}

/** One-time sandbox setup: create API user + API key (run via npm run mtn:setup) */
export async function createSandboxApiUser(providerCallbackHost) {
  if (!SUBSCRIPTION_KEY) {
    throw new Error('MTN_MOMO_SUBSCRIPTION_KEY is required');
  }
  const userId = generateReferenceId();
  await mtnFetch('/v1_0/apiuser', {
    method: 'POST',
    headers: {
      'X-Reference-Id': userId,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providerCallbackHost: providerCallbackHost || 'https://webhook.site',
    }),
  });

  const keyBody = await mtnFetch(`/v1_0/apiuser/${userId}/apikey`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
    },
  });

  return { apiUser: userId, apiKey: keyBody.apiKey };
}
