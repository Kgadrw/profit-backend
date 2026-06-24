/**
 * One-off: delete clients by name (all users). Usage:
 *   node scripts/delete-clients-by-name.mjs Mufasa jimmy John
 */
import dns from 'node:dns';
import 'dotenv/config';
import mongoose from 'mongoose';
import Client from '../src/models/Client.js';

if (process.env.DNS_SERVERS?.trim()) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
} else {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const names = process.argv.slice(2).map((n) => n.trim()).filter(Boolean);
if (names.length === 0) {
  console.error('Usage: node scripts/delete-clients-by-name.mjs <name> [name...]');
  process.exit(1);
}

const DB_USERNAME = process.env.DB_USERNAME;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_CLUSTER = process.env.DB_CLUSTER;
const DB_NAME = process.env.DB_NAME || 'profit-pilot';
const encodedPassword = encodeURIComponent(DB_PASSWORD);
const uri =
  process.env.MONGODB_URI ||
  `mongodb+srv://${DB_USERNAME}:${encodedPassword}@${DB_CLUSTER}/${DB_NAME}?retryWrites=true&w=majority`;

await mongoose.connect(uri);

const regexes = names.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
const found = await Client.find({ $or: regexes.map((r) => ({ name: r })) }).lean();

console.log(`Found ${found.length} client(s):`);
for (const c of found) {
  console.log(`  - ${c._id} | ${c.name} | ${c.email || '—'} | userId=${c.userId}`);
}

if (found.length === 0) {
  await mongoose.disconnect();
  process.exit(0);
}

const ids = found.map((c) => c._id);
const result = await Client.deleteMany({ _id: { $in: ids } });
console.log(`Deleted ${result.deletedCount} client(s).`);

await mongoose.disconnect();
