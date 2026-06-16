import bcrypt from 'bcrypt';
import PlatformSettings from '../models/PlatformSettings.js';

const LEGACY_ADMIN_EMAILS = new Set(['admin', 'admin@trippo.rw', 'admin@trippo.com']);

let cache = {
  adminEmail: process.env.ADMIN_EMAIL || 'admin@trippo.rw',
  subscriptionAmount: Number(process.env.SUBSCRIPTION_AMOUNT || 10000),
  trialDays: Number(process.env.TRIAL_DAYS || 7),
  currency: 'RWF',
  supportEmail: process.env.SUPPORT_EMAIL || process.env.SMTP_USER || '',
  supportPhone: process.env.SUPPORT_PHONE || '0791998365',
  whatsappNumber: process.env.SUPPORT_WHATSAPP || process.env.SUPPORT_PHONE || '0791998365',
  instagramUrl: process.env.INSTAGRAM_URL || 'https://instagram.com/trippoltd',
  companyName: process.env.COMPANY_NAME || 'Trippo',
  maintenanceMode: false,
  updatedAt: null,
};

function applyDocToCache(doc) {
  if (!doc) return;
  cache = {
    adminEmail: doc.adminEmail || cache.adminEmail,
    subscriptionAmount: doc.subscriptionAmount ?? cache.subscriptionAmount,
    trialDays: doc.trialDays ?? cache.trialDays,
    currency: doc.currency || 'RWF',
    supportEmail: doc.supportEmail ?? cache.supportEmail,
    supportPhone: doc.supportPhone ?? cache.supportPhone,
    whatsappNumber: doc.whatsappNumber ?? cache.whatsappNumber,
    instagramUrl: doc.instagramUrl ?? cache.instagramUrl,
    companyName: doc.companyName || cache.companyName,
    maintenanceMode: Boolean(doc.maintenanceMode),
    updatedAt: doc.updatedAt || doc.createdAt || null,
  };
}

export function getSubscriptionAmount() {
  return cache.subscriptionAmount;
}

export function getTrialDays() {
  return cache.trialDays;
}

export function getPlatformSettingsSnapshot() {
  return { ...cache };
}

export async function initPlatformSettings() {
  let doc = await PlatformSettings.findOne({ key: 'platform' });
  if (!doc) {
    const defaultPin = process.env.ADMIN_PIN || '2026';
    const adminPinHash = await bcrypt.hash(defaultPin, 10);
    doc = await PlatformSettings.create({
      key: 'platform',
      adminEmail: process.env.ADMIN_EMAIL || 'admin@trippo.rw',
      adminPinHash,
      subscriptionAmount: Number(process.env.SUBSCRIPTION_AMOUNT || 10000),
      trialDays: Number(process.env.TRIAL_DAYS || 7),
      currency: 'RWF',
      supportEmail: process.env.SUPPORT_EMAIL || process.env.SMTP_USER || '',
      supportPhone: process.env.SUPPORT_PHONE || '0791998365',
      whatsappNumber: process.env.SUPPORT_WHATSAPP || process.env.SUPPORT_PHONE || '0791998365',
      instagramUrl: process.env.INSTAGRAM_URL || 'https://instagram.com/trippoltd',
      companyName: process.env.COMPANY_NAME || 'Trippo',
      maintenanceMode: false,
    });
    console.log('✅ Platform settings initialized');
  }
  applyDocToCache(doc);
  return doc;
}

export async function getPlatformSettingsDocument() {
  let doc = await PlatformSettings.findOne({ key: 'platform' });
  if (!doc) {
    doc = await initPlatformSettings();
  }
  return doc;
}

export function isAdminLoginEmail(email) {
  const normalized = String(email || '').toLowerCase().trim();
  return LEGACY_ADMIN_EMAILS.has(normalized) || normalized === cache.adminEmail;
}

export async function verifyAdminPin(pin) {
  const doc = await getPlatformSettingsDocument();
  return doc.comparePin(pin);
}

export async function tryAdminLogin(email, pin) {
  if (!isAdminLoginEmail(email)) return false;
  if (!pin || pin.length !== 4) return false;
  return verifyAdminPin(pin);
}

export async function updatePlatformSettings(updates, currentPin) {
  const doc = await getPlatformSettingsDocument();
  const pinOk = await doc.comparePin(String(currentPin || ''));
  if (!pinOk) {
    const error = new Error('Current PIN is incorrect');
    error.statusCode = 401;
    throw error;
  }

  if (updates.adminEmail !== undefined) {
    const nextEmail = String(updates.adminEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      const error = new Error('Please enter a valid admin email');
      error.statusCode = 400;
      throw error;
    }
    doc.adminEmail = nextEmail;
  }

  if (updates.newPin) {
    const newPin = String(updates.newPin);
    const confirmPin = String(updates.confirmNewPin || '');
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      const error = new Error('New PIN must be exactly 4 digits');
      error.statusCode = 400;
      throw error;
    }
    if (newPin !== confirmPin) {
      const error = new Error('New PIN and confirmation do not match');
      error.statusCode = 400;
      throw error;
    }
    doc.adminPinHash = await bcrypt.hash(newPin, 10);
  }

  if (updates.subscriptionAmount !== undefined) {
    const amount = Number(updates.subscriptionAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      const error = new Error('Subscription amount must be a positive number');
      error.statusCode = 400;
      throw error;
    }
    doc.subscriptionAmount = Math.round(amount);
  }

  if (updates.trialDays !== undefined) {
    const days = Number(updates.trialDays);
    if (!Number.isFinite(days) || days < 0 || days > 90) {
      const error = new Error('Trial days must be between 0 and 90');
      error.statusCode = 400;
      throw error;
    }
    doc.trialDays = Math.round(days);
  }

  if (updates.supportEmail !== undefined) {
    doc.supportEmail = String(updates.supportEmail).trim();
  }

  if (updates.supportPhone !== undefined) {
    doc.supportPhone = String(updates.supportPhone).trim();
  }

  if (updates.whatsappNumber !== undefined) {
    doc.whatsappNumber = String(updates.whatsappNumber).trim();
  }

  if (updates.instagramUrl !== undefined) {
    doc.instagramUrl = String(updates.instagramUrl).trim();
  }

  if (updates.companyName !== undefined) {
    doc.companyName = String(updates.companyName).trim() || 'Trippo';
  }

  if (updates.maintenanceMode !== undefined) {
    doc.maintenanceMode = Boolean(updates.maintenanceMode);
  }

  await doc.save();
  applyDocToCache(doc);
  return doc;
}

export function serializePlatformSettingsForAdmin(doc) {
  const row = doc?.toObject ? doc.toObject() : doc;
  return {
    adminEmail: row.adminEmail,
    subscriptionAmount: row.subscriptionAmount,
    trialDays: row.trialDays,
    currency: row.currency || 'RWF',
    supportEmail: row.supportEmail || '',
    supportPhone: row.supportPhone || '',
    whatsappNumber: row.whatsappNumber || '',
    instagramUrl: row.instagramUrl || '',
    companyName: row.companyName || 'Trippo',
    maintenanceMode: Boolean(row.maintenanceMode),
    updatedAt: row.updatedAt,
  };
}

export function serializePlatformContactForPublic(doc) {
  const row = doc?.toObject ? doc.toObject() : doc;
  const snapshot = getPlatformSettingsSnapshot();
  return {
    companyName: row.companyName || snapshot.companyName || 'Trippo',
    supportEmail: row.supportEmail ?? snapshot.supportEmail ?? '',
    supportPhone: row.supportPhone || snapshot.supportPhone || '',
    whatsappNumber: row.whatsappNumber || row.supportPhone || snapshot.whatsappNumber || snapshot.supportPhone || '',
    instagramUrl: row.instagramUrl || snapshot.instagramUrl || '',
  };
}
