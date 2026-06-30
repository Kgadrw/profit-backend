import crypto from 'crypto';
import CompanyDocument from '../models/CompanyDocument.js';
import User from '../models/User.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import {
  deleteStoredFileByUrl,
  getStoredFile,
  parseStoredFileUrl,
  sendStoredFile,
} from '../utils/storedFileService.js';
import {
  buildDocumentSignaturePayload,
  hashBuffer,
  signDocumentPayload,
  verifyDocumentSignature,
} from '../utils/documentCrypto.js';

const REGISTRY_TYPES = ['general', 'contract', 'policy', 'template'];
const REGISTRY_STATUSES = ['draft', 'active', 'archived', 'expired'];
const SHARE_PERMISSIONS = ['view', 'download', 'edit'];

const normalizeDocumentDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

function actorFromRequest(req) {
  return {
    uploadedByUserId: req.user?._id,
    uploadedByName: req.user?.name || 'User',
    grantedByUserId: req.user?._id,
    grantedByName: req.user?.name || 'User',
  };
}

async function loadStoredFileFromUrl(fileUrl) {
  const parsed = parseStoredFileUrl(fileUrl);
  if (!parsed?.userId || !parsed.filename) return null;
  return getStoredFile(parsed.userId, parsed.kind || 'document', parsed.filename);
}

async function computeFileHashFromUrl(fileUrl) {
  const stored = await loadStoredFileFromUrl(fileUrl);
  if (!stored?.data) return null;
  return hashBuffer(stored.data);
}

function userCanAccessDocument(req, document) {
  if (String(document.userId) === String(req.user._id)) return true;
  const share = (document.shares || []).find(
    (row) => String(row.targetUserId) === String(req.user._id),
  );
  return Boolean(share);
}

function userCanEditDocument(req, document) {
  if (String(document.userId) === String(req.user._id)) return true;
  const share = (document.shares || []).find(
    (row) => String(row.targetUserId) === String(req.user._id) && row.permission === 'edit',
  );
  return Boolean(share);
}

function applyRegistryFields(document, body) {
  const fields = [
    'title',
    'category',
    'note',
    'registryType',
    'registryStatus',
    'effectiveDate',
    'expiryDate',
    'renewalDate',
    'ownerUserId',
    'clientId',
    'contractId',
    'policyScope',
  ];
  for (const field of fields) {
    if (body[field] === undefined) continue;
    if (['effectiveDate', 'expiryDate', 'renewalDate'].includes(field)) {
      document[field] = normalizeDocumentDate(body[field]) || null;
    } else if (field === 'registryType') {
      if (REGISTRY_TYPES.includes(body.registryType)) document.registryType = body.registryType;
    } else if (field === 'registryStatus') {
      if (REGISTRY_STATUSES.includes(body.registryStatus)) document.registryStatus = body.registryStatus;
    } else if (typeof body[field] === 'string') {
      document[field] = body[field].trim();
    } else {
      document[field] = body[field];
    }
  }
}

export const getDocumentsSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const scope = buildListQuery(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const documents = await CompanyDocument.find(scope)
      .select('registryType registryStatus expiryDate signatures shares versions')
      .lean();

    const byType = { general: 0, contract: 0, policy: 0, template: 0 };
    const byStatus = { draft: 0, active: 0, archived: 0, expired: 0 };
    let expiringSoon = 0;
    let signedCount = 0;
    let sharedCount = 0;

    for (const doc of documents) {
      const type = doc.registryType || 'general';
      const status = doc.registryStatus || 'draft';
      if (type in byType) byType[type] += 1;
      if (status in byStatus) byStatus[status] += 1;
      if (doc.expiryDate) {
        const expiry = new Date(doc.expiryDate);
        const in30 = new Date(today);
        in30.setDate(in30.getDate() + 30);
        if (expiry >= today && expiry <= in30) expiringSoon += 1;
      }
      if ((doc.signatures || []).length > 0) signedCount += 1;
      if ((doc.shares || []).length > 0) sharedCount += 1;
    }

    res.json({
      data: {
        totalDocuments: documents.length,
        byType,
        byStatus,
        expiringSoon,
        signedCount,
        sharedCount,
      },
    });
  } catch (error) {
    console.error('Error fetching documents summary:', error);
    handleScopeError(res, error);
  }
};

export const getDocuments = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const { startDate, endDate, registryType, registryStatus } = req.query;
    const query = buildListQuery(req);

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }
    if (REGISTRY_TYPES.includes(registryType)) query.registryType = registryType;
    if (REGISTRY_STATUSES.includes(registryStatus)) query.registryStatus = registryStatus;

    const documents = await CompanyDocument.find(query).sort({ date: -1, createdAt: -1 });
    res.json({ data: documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    handleScopeError(res, error);
  }
};

export const getDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json({ data: document });
  } catch (error) {
    console.error('Error fetching document:', error);
    handleScopeError(res, error);
  }
};

export const getDocumentProfile = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });

    res.json({
      data: {
        document: document.toObject(),
        versionCount: (document.versions || []).length + 1,
        shareCount: (document.shares || []).length,
        signatureCount: (document.signatures || []).length,
        isSigned: (document.signatures || []).some((row) => row.verificationStatus === 'verified'),
      },
    });
  } catch (error) {
    console.error('Error fetching document profile:', error);
    handleScopeError(res, error);
  }
};

export const getDocumentFile = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (!userCanAccessDocument(req, document)) {
      return res.status(403).json({ error: 'You do not have access to this document file' });
    }

    const stored = await loadStoredFileFromUrl(document.fileUrl);
    if (!stored) return res.status(404).json({ error: 'File not found' });

    return sendStoredFile(res, stored);
  } catch (error) {
    console.error('Error serving document file:', error);
    handleScopeError(res, error);
  }
};

export const createDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const { title, category, date, note, fileUrl, fileName, fileSize } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'Document title is required' });
    if (!fileUrl || !fileName) return res.status(400).json({ error: 'Document file is required' });

    const contentHash = (await computeFileHashFromUrl(fileUrl)) || undefined;
    const scope = buildCreateScope(req);
    const actor = actorFromRequest(req);

    const document = new CompanyDocument({
      title: title.trim(),
      category: category ? category.trim() : 'general',
      date: normalizeDocumentDate(date),
      note: note ? note.trim() : undefined,
      fileUrl,
      fileName,
      fileSize: fileSize !== undefined ? Number(fileSize) : undefined,
      contentHash,
      currentVersionNumber: 1,
      ownerUserId: scope.userId,
      versions: [
        {
          versionNumber: 1,
          fileUrl,
          fileName,
          fileSize: fileSize !== undefined ? Number(fileSize) : undefined,
          contentHash,
          changeNote: 'Initial upload',
          uploadedByUserId: actor.uploadedByUserId,
          uploadedByName: actor.uploadedByName,
          uploadedAt: new Date(),
        },
      ],
      ...scope,
    });

    applyRegistryFields(document, req.body);
    if (!document.registryType || document.registryType === 'general') {
      if (document.category === 'contracts' || document.category === 'contract') {
        document.registryType = 'contract';
      }
    }

    await document.save();
    res.status(201).json({ data: document });
  } catch (error) {
    console.error('Error creating document:', error);
    handleScopeError(res, error);
  }
};

export const updateDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (!userCanEditDocument(req, document)) {
      return res.status(403).json({ error: 'You do not have edit access to this document' });
    }

    const { title, category, date, note, fileUrl, fileName, fileSize, changeNote } = req.body;

    if (title !== undefined) document.title = title.trim();
    if (category !== undefined) document.category = category ? category.trim() : 'general';
    if (date !== undefined) document.date = normalizeDocumentDate(date);
    if (note !== undefined) document.note = note ? note.trim() : undefined;
    applyRegistryFields(document, req.body);

    if (fileUrl && fileName && fileUrl !== document.fileUrl) {
      const contentHash = (await computeFileHashFromUrl(fileUrl)) || undefined;
      document.versions = document.versions || [];
      document.versions.unshift({
        versionNumber: document.currentVersionNumber,
        fileUrl: document.fileUrl,
        fileName: document.fileName,
        fileSize: document.fileSize,
        contentHash: document.contentHash,
        changeNote: changeNote?.trim() || 'Previous version',
        uploadedByUserId: document.userId,
        uploadedAt: document.updatedAt || new Date(),
      });
      if (document.versions.length > 50) document.versions = document.versions.slice(0, 50);

      document.currentVersionNumber += 1;
      document.fileUrl = fileUrl;
      document.fileName = fileName;
      document.fileSize = fileSize !== null ? Number(fileSize) : undefined;
      document.contentHash = contentHash;
    }

    await document.save();
    res.json({ data: document });
  } catch (error) {
    console.error('Error updating document:', error);
    handleScopeError(res, error);
  }
};

export const restoreDocumentVersion = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (!userCanEditDocument(req, document)) {
      return res.status(403).json({ error: 'You do not have edit access to this document' });
    }

    const version = (document.versions || []).find(
      (row) => String(row._id) === String(req.params.versionId),
    );
    if (!version) return res.status(404).json({ error: 'Version not found' });

    document.versions.unshift({
      versionNumber: document.currentVersionNumber,
      fileUrl: document.fileUrl,
      fileName: document.fileName,
      fileSize: document.fileSize,
      contentHash: document.contentHash,
      changeNote: `Snapshot before restore to v${version.versionNumber}`,
      ...actorFromRequest(req),
      uploadedAt: new Date(),
    });

    document.currentVersionNumber += 1;
    document.fileUrl = version.fileUrl;
    document.fileName = version.fileName;
    document.fileSize = version.fileSize;
    document.contentHash = version.contentHash;

    await document.save();
    res.json({ data: document });
  } catch (error) {
    console.error('Error restoring document version:', error);
    handleScopeError(res, error);
  }
};

export const addDocumentShare = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (String(document.userId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the document owner can manage sharing' });
    }

    const { targetUserId, permission } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'Target user is required' });
    if (permission && !SHARE_PERMISSIONS.includes(permission)) {
      return res.status(400).json({ error: 'Invalid share permission' });
    }

    const targetUser = await User.findById(targetUserId).select('name email');
    if (!targetUser) return res.status(400).json({ error: 'Invalid target user' });

    document.shares = (document.shares || []).filter(
      (row) => String(row.targetUserId) !== String(targetUserId),
    );
    document.shares.push({
      targetUserId,
      targetName: targetUser.name || targetUser.email,
      permission: permission || 'view',
      ...actorFromRequest(req),
      grantedAt: new Date(),
    });

    await document.save();
    res.json({ data: document });
  } catch (error) {
    console.error('Error adding document share:', error);
    handleScopeError(res, error);
  }
};

export const removeDocumentShare = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (String(document.userId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the document owner can manage sharing' });
    }

    document.shares = (document.shares || []).filter(
      (row) => String(row._id) !== String(req.params.shareId),
    );
    await document.save();
    res.json({ data: document });
  } catch (error) {
    console.error('Error removing document share:', error);
    handleScopeError(res, error);
  }
};

export const signDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (!userCanAccessDocument(req, document)) {
      return res.status(403).json({ error: 'You do not have access to sign this document' });
    }

    const fileHash = document.contentHash || (await computeFileHashFromUrl(document.fileUrl));
    if (!fileHash) return res.status(400).json({ error: 'Could not compute document hash' });

    const payload = buildDocumentSignaturePayload(document, document.currentVersionNumber, fileHash);
    const signatureHash = signDocumentPayload(payload);

    document.signatures = document.signatures || [];
    document.signatures.unshift({
      signerName: req.user.name || req.body.signerName || 'User',
      signerEmail: req.user.email || req.body.signerEmail,
      signerUserId: req.user._id,
      documentHash: fileHash,
      signatureHash,
      algorithm: 'SHA-256',
      signedAt: new Date(),
      verificationStatus: 'verified',
    });

    if (document.registryStatus === 'draft') document.registryStatus = 'active';
    await document.save();

    res.status(201).json({ data: document, signatureHash, documentHash: fileHash });
  } catch (error) {
    console.error('Error signing document:', error);
    handleScopeError(res, error);
  }
};

export const verifyDocumentSignatures = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });

    const fileHash = document.contentHash || (await computeFileHashFromUrl(document.fileUrl));
    const payload = fileHash
      ? buildDocumentSignaturePayload(document, document.currentVersionNumber, fileHash)
      : null;

    const results = (document.signatures || []).map((sig) => {
      const hashMatches = fileHash && sig.documentHash === fileHash;
      const signatureValid = payload
        ? verifyDocumentSignature(payload, sig.signatureHash)
        : false;
      const verified = hashMatches && signatureValid;
      return {
        id: sig._id,
        signerName: sig.signerName,
        signedAt: sig.signedAt,
        verificationStatus: verified ? 'verified' : 'invalid',
        hashMatches,
        signatureValid,
      };
    });

    res.json({ data: { documentId: document._id, currentHash: fileHash, results } });
  } catch (error) {
    console.error('Error verifying document signatures:', error);
    handleScopeError(res, error);
  }
};

export const deleteDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!document) return res.status(404).json({ error: 'Document not found' });

    const urls = new Set([document.fileUrl, ...(document.versions || []).map((v) => v.fileUrl)]);
    for (const url of urls) {
      if (url) await deleteStoredFileByUrl(url);
    }

    res.json({ message: 'Document deleted' });
  } catch (error) {
    console.error('Error deleting document:', error);
    handleScopeError(res, error);
  }
};
