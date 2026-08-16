/**
 * Inspect / clear Trippo DB pending subscription payments for a phone number.
 * Does NOT clear MTN or Paypack-side pending prompts (those are outside our DB).
 *
 * Usage:
 *   node scripts/clear-pending-msisdn.js 0791998365
 *   node scripts/clear-pending-msisdn.js 0791998365 --apply
 */
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dnsServers = String(process.env.DNS_SERVERS || '8.8.8.8,8.8.4.4')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

const { default: SubscriptionPayment } = await import('../src/models/SubscriptionPayment.js');
const { findTransactionEvents, normalizePhoneNumber } = await import('../src/utils/paypack.js');

function buildMongoUri() {
  const user = process.env.DB_USERNAME;
  const pass = process.env.DB_PASSWORD;
  const cluster = process.env.DB_CLUSTER;
  const db = process.env.DB_NAME || 'profit-pilot';
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (user && pass && cluster) {
    return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${cluster}/${db}?retryWrites=true&w=majority&appName=Cluster0`;
  }
  throw new Error('Missing MongoDB env (MONGODB_URI or DB_USERNAME/DB_PASSWORD/DB_CLUSTER)');
}

function phoneVariants(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.startsWith('250') ? `0${digits.slice(3)}` : digits.startsWith('0') ? digits : `0${digits}`;
  const intl = local.startsWith('0') ? `250${local.slice(1)}` : digits;
  const normalized = normalizePhoneNumber(raw) || local;
  return [...new Set([raw, local, intl, normalized].filter(Boolean))];
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--apply');
  const apply = process.argv.includes('--apply');
  const phone = args[0];
  if (!phone) {
    console.error('Usage: node scripts/clear-pending-msisdn.js <phone> [--apply]');
    process.exit(1);
  }

  const variants = phoneVariants(phone);
  console.log('DNS:', dns.getServers().join(', '));
  console.log('Phone variants:', variants.join(', '));

  await mongoose.connect(buildMongoUri(), { serverSelectionTimeoutMS: 20000 });

  const pending = await SubscriptionPayment.find({
    msisdn: { $in: variants },
    status: 'PENDING',
  })
    .sort({ createdAt: -1 })
    .lean();

  console.log(`\nTrippo DB PENDING for this phone: ${pending.length}`);
  for (const row of pending.slice(0, 20)) {
    console.log(
      `- ${row.referenceId} | ${row.amount} ${row.currency} | ${row.msisdn} | created ${row.createdAt}`,
    );
  }

  try {
    const normalized = variants.find((v) => /^0(72|73|78|79)/.test(String(v))) || variants[0];
    const ev = await findTransactionEvents({
      client: normalized,
      kind: 'CASHIN',
      status: 'pending',
    });
    const paypackPending = Number(ev.total) || 0;
    console.log(`\nPaypack pending CASHIN events for ${normalized}: ${paypackPending}`);
    const transactions = ev.transactions || ev.data || [];
    if (Array.isArray(transactions) && transactions.length) {
      for (const tx of transactions.slice(0, 10)) {
        console.log(
          `  - ref=${tx.ref || tx.reference || '?'} status=${tx.status} created=${tx.created_at || tx.createdAt || '?'}`,
        );
      }
    } else {
      console.log('  (no transaction rows listed; response keys:', Object.keys(ev || {}).join(', '), ')');
    }
  } catch (error) {
    console.warn('\nCould not query Paypack pending events:', error.message);
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to mark Trippo DB PENDING rows as FAILED.');
    console.log(
      'Note: Paypack/MTN pending prompts cannot be cancelled from Trippo — the customer must dial *182*7*1# (MTN) or *185*7*1# (Airtel).',
    );
    await mongoose.disconnect();
    return;
  }

  if (!pending.length) {
    console.log('\nNothing to clear in Trippo DB.');
    await mongoose.disconnect();
    return;
  }

  const result = await SubscriptionPayment.updateMany(
    { msisdn: { $in: variants }, status: 'PENDING' },
    {
      $set: {
        status: 'FAILED',
        providerStatus: 'cancelled_by_admin',
        mtnStatus: 'cleared_locally',
        mtnReason: 'Cleared stale pending via clear-pending-msisdn script',
      },
      $push: {
        syncIssues: {
          code: 'CLEARED_LOCALLY',
          message: 'Marked FAILED to unblock billing; Paypack/MTN prompts may still exist',
          at: new Date(),
        },
      },
    },
  );

  console.log(`\nUpdated ${result.modifiedCount} Trippo payment(s) to FAILED.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
