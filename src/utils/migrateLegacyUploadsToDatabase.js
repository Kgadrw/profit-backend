import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import StoredFile from '../models/StoredFile.js';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import CompanyDocument from '../models/CompanyDocument.js';
import Expense from '../models/Expense.js';
import Income from '../models/Income.js';
import Bill from '../models/Bill.js';
import Payroll from '../models/Payroll.js';
import Tax from '../models/Tax.js';
import BankDeposit from '../models/BankDeposit.js';
import Loan from '../models/Loan.js';
import { buildStoredFileUrl } from './storedFileService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');

const FOLDER_KIND_MAP = {
  profiles: 'profile',
  receipts: 'receipt',
  documents: 'document',
};

function guessMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeByExt = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
  };
  return mimeByExt[ext] || 'application/octet-stream';
}

/** Convert old `/uploads/...` URLs to `/api/files/...` database-backed URLs. */
export function normalizeLegacyFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return fileUrl;

  const legacyMatch = fileUrl.match(
    /\/uploads\/(profiles|receipts|documents)\/([^/?#]+)\/([^/?#]+)/,
  );
  if (!legacyMatch) return fileUrl;

  const folder = legacyMatch[1];
  const ownerId = legacyMatch[2];
  const filename = path.basename(legacyMatch[3]);
  const kind = FOLDER_KIND_MAP[folder];
  if (!kind) return fileUrl;

  return buildStoredFileUrl(ownerId, kind, filename);
}

async function importDiskFiles() {
  let migrated = 0;

  if (!fs.existsSync(uploadsRoot)) {
    return migrated;
  }

  for (const [folder, kind] of Object.entries(FOLDER_KIND_MAP)) {
    const kindRoot = path.join(uploadsRoot, folder);
    if (!fs.existsSync(kindRoot)) continue;

    const ownerEntries = fs.readdirSync(kindRoot, { withFileTypes: true });
    for (const ownerEntry of ownerEntries) {
      if (!ownerEntry.isDirectory()) continue;

      const ownerId = ownerEntry.name;
      const ownerDir = path.join(kindRoot, ownerId);
      const filenames = fs.readdirSync(ownerDir);

      for (const filename of filenames) {
        const filePath = path.join(ownerDir, filename);
        if (!fs.statSync(filePath).isFile()) continue;

        const safeName = path.basename(filename);
        const existing = await StoredFile.findOne({
          userId: ownerId,
          kind,
          filename: safeName,
        }).lean();
        if (existing) continue;

        const buffer = fs.readFileSync(filePath);
        await StoredFile.create({
          userId: ownerId,
          kind,
          filename: safeName,
          originalName: safeName,
          mimeType: guessMimeType(safeName),
          data: buffer,
          size: buffer.length,
        });
        migrated += 1;
      }
    }
  }

  return migrated;
}

async function updateUrlField(Model, fieldName) {
  const docs = await Model.find({
    [fieldName]: { $regex: /\/uploads\/(profiles|receipts|documents)\// },
  }).select(`_id ${fieldName}`);

  let updated = 0;
  for (const doc of docs) {
    const nextUrl = normalizeLegacyFileUrl(doc[fieldName]);
    if (nextUrl && nextUrl !== doc[fieldName]) {
      await Model.updateOne({ _id: doc._id }, { $set: { [fieldName]: nextUrl } });
      updated += 1;
    }
  }
  return updated;
}

async function updateLoanPaymentReceiptUrls() {
  const loans = await Loan.find({
    'payments.receiptUrl': { $regex: /\/uploads\/(profiles|receipts|documents)\// },
  }).select('payments');

  let updated = 0;
  for (const loan of loans) {
    let changed = false;
    for (const payment of loan.payments || []) {
      if (!payment.receiptUrl?.includes('/uploads/')) continue;
      const nextUrl = normalizeLegacyFileUrl(payment.receiptUrl);
      if (nextUrl && nextUrl !== payment.receiptUrl) {
        payment.receiptUrl = nextUrl;
        changed = true;
        updated += 1;
      }
    }
    if (changed) {
      await loan.save();
    }
  }
  return updated;
}

export async function migrateLegacyUploadsToDatabase() {
  const migrated = await importDiskFiles();

  const urlUpdates =
    (await updateUrlField(User, 'profilePictureUrl')) +
    (await updateUrlField(Workspace, 'profilePictureUrl')) +
    (await updateUrlField(CompanyDocument, 'fileUrl')) +
    (await updateUrlField(Expense, 'receiptUrl')) +
    (await updateUrlField(Income, 'receiptUrl')) +
    (await updateUrlField(Bill, 'receiptUrl')) +
    (await updateUrlField(Payroll, 'receiptUrl')) +
    (await updateUrlField(Tax, 'receiptUrl')) +
    (await updateUrlField(BankDeposit, 'receiptUrl')) +
    (await updateLoanPaymentReceiptUrls());

  return { migrated, urlsUpdated: urlUpdates };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const { connectDatabase } = await import('../config/database.js');
  try {
    await connectDatabase();
    const result = await migrateLegacyUploadsToDatabase();
    console.log(
      `Migration complete: ${result.migrated} file(s) imported, ${result.urlsUpdated} URL(s) updated.`,
    );
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}
