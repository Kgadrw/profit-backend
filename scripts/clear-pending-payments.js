/**
 * Mark all PENDING SubscriptionPayment rows as FAILED so Billing can start a fresh MoMo prompt.
 * Does NOT cancel MTN USSD prompts on the phone — user must dial *182*7*1# for that.
 *
 * Usage: node scripts/clear-pending-payments.js [phone]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SubscriptionPayment from '../src/models/SubscriptionPayment.js';
import { connectDatabase } from '../src/config/database.js';
import { syncPaymentStatus } from '../src/controllers/subscriptionController.js';
import { getPaypackPendingCashinCount } from '../src/utils/paypack.js';

const phone = process.argv[2] || '0791998365';

await connectDatabase();

const query = { status: 'PENDING' };
if (phone) query.msisdn = phone.replace(/\D/g, '').replace(/^250/, '0').replace(/^(\d{9})$/, '0$1');

const pending = await SubscriptionPayment.find(query).sort({ createdAt: -1 });
console.log(`Found ${pending.length} PENDING payment(s) in database.`);

for (const doc of pending) {
  let payment = await syncPaymentStatus(doc, { mode: 'full' });
  if (payment.status === 'PENDING') {
    payment.status = 'FAILED';
    payment.providerStatus = 'cleared';
    payment.mtnStatus = 'cleared';
    payment.syncIssues = payment.syncIssues || [];
    payment.syncIssues.push({
      code: 'PAYMENT_CLEARED',
      message: 'Cleared to allow a fresh MoMo prompt.',
      at: new Date(),
    });
    payment.lastSyncAt = new Date();
    await payment.save();
  }
  console.log(`  ${payment.referenceId} → ${payment.status}`);
}

const paypackPending = phone ? await getPaypackPendingCashinCount(phone) : 0;
console.log(`\nDatabase cleared. Paypack pending on ${phone}: ${paypackPending}`);
if (paypackPending > 0) {
  console.log('MTN prompts must be cancelled on the phone: dial *182*7*1# → Pending approvals → reject all.');
}

await mongoose.disconnect();
