/**
 * One-time MTN MoMo sandbox setup — creates API User + API Key.
 * Usage: npm run mtn:setup
 */
import 'dotenv/config';
import { createSandboxApiUser } from '../src/utils/mtnMomo.js';

const host = process.env.MTN_MOMO_CALLBACK_HOST || 'https://webhook.site';

try {
  const { apiUser, apiKey } = await createSandboxApiUser(host);
  console.log('\n✅ MTN sandbox API credentials created. Add these to backend/.env:\n');
  console.log(`MTN_MOMO_API_USER=${apiUser}`);
  console.log(`MTN_MOMO_API_KEY=${apiKey}`);
  console.log('\nThen restart the backend server.\n');
} catch (error) {
  console.error('❌ MTN setup failed:', error.message);
  if (error.body) console.error(error.body);
  process.exit(1);
}
