/**
 * Verify Paypack is configured for live MoMo payment prompts.
 * Usage: node scripts/verify-paypack-prompts.js [phone]
 *
 * Without a phone: checks credentials, webhook mode, and auth only.
 * With a phone (078/079/072/073): sends a minimal cashin to confirm Paypack accepts the request.
 */
import 'dotenv/config';
import {
  cashin,
  generateIdempotencyKey,
  getAccessToken,
  getPaymentPublicConfig,
  isMockPaymentsEnabled,
  isPaypackConfigured,
  parseCashinResponse,
  validateRwandaMobileNumber,
} from '../src/utils/paypack.js';
import { getSubscriptionAmount } from '../src/utils/platformSettings.js';

const phoneArg = process.argv[2];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

async function main() {
  console.log('Paypack payment prompt verification\n');

  if (isMockPaymentsEnabled()) {
    fail('SUBSCRIPTION_MOCK_PAYMENTS=true — mock mode does not send real MoMo prompts.');
  }

  if (!isPaypackConfigured()) {
    fail('Paypack credentials missing. Set PAYPACK_CLIENT_ID and PAYPACK_CLIENT_SECRET in .env');
  }
  ok('Paypack credentials present');

  const config = getPaymentPublicConfig();
  console.log('Payment config:', {
    amount: getSubscriptionAmount(),
    webhookMode: config.webhookMode,
    livePrompts: config.livePrompts,
  });

  if (!config.livePrompts) {
    fail(
      `PAYPACK_WEBHOOK_MODE=${config.webhookMode} — set PAYPACK_WEBHOOK_MODE=production for real prompts.`,
    );
  }
  ok(`Webhook mode is production (live prompts enabled)`);

  try {
    await getAccessToken();
    ok('Paypack authentication succeeded');
  } catch (error) {
    fail(`Paypack authentication failed: ${error.message}`);
  }

  if (!phoneArg) {
    console.log('\nOptional: pass a MoMo number to test cashin, e.g. node scripts/verify-paypack-prompts.js 0781234567');
    console.log('A real prompt may appear on that phone — only use your own number.');
    process.exit(0);
  }

  const phoneCheck = validateRwandaMobileNumber(phoneArg);
  if (!phoneCheck.valid) {
    fail(phoneCheck.error);
  }

  const testAmount = Math.min(100, getSubscriptionAmount());
  console.log(`\nSending test cashin: ${testAmount} RWF → ${phoneCheck.normalized} (${phoneCheck.network})`);

  try {
    const result = await cashin({
      amount: testAmount,
      number: phoneCheck.normalized,
      idempotencyKey: generateIdempotencyKey(),
    });
    const parsed = parseCashinResponse(result);
    if (!parsed.ref) {
      fail(`Cashin succeeded but no ref returned: ${JSON.stringify(result)}`);
    }
    ok(`Cashin accepted — ref ${parsed.ref}, status ${parsed.status}`);
    console.log('\nCheck the phone for the MoMo approval prompt.');
    console.log(`Dial ${phoneCheck.network === 'airtel' ? '*185*7*1#' : '*182*7*1#'} if it does not appear.`);
  } catch (error) {
    fail(`Cashin failed: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
