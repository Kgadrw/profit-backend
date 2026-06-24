import dns from 'node:dns';
import 'dotenv/config';
import mongoose from 'mongoose';
import Client from '../src/models/Client.js';

dns.setServers((process.env.DNS_SERVERS || '8.8.8.8,8.8.4.4').split(',').map((s) => s.trim()));

const encodedPassword = encodeURIComponent(process.env.DB_PASSWORD);
const uri =
  process.env.MONGODB_URI ||
  `mongodb+srv://${process.env.DB_USERNAME}:${encodedPassword}@${process.env.DB_CLUSTER}/${process.env.DB_NAME || 'profit-pilot'}?retryWrites=true&w=majority`;

await mongoose.connect(uri);
const all = await Client.find({}).select('name email phone userId').lean();
console.log(`Total clients in DB: ${all.length}`);
for (const c of all) {
  console.log(`${c._id} | ${c.name} | ${c.email || '—'} | ${c.phone || '—'}`);
}
await mongoose.disconnect();
