import crypto from 'crypto';

export function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function buildDocumentSignaturePayload(document, versionNumber, fileHash) {
  return JSON.stringify({
    documentId: String(document._id),
    title: document.title,
    versionNumber,
    fileHash,
    registryType: document.registryType || 'general',
  });
}

export function signDocumentPayload(payload, secret = 'trippo-doc-signature') {
  return crypto.createHash('sha256').update(`${payload}:${secret}`).digest('hex');
}

export function verifyDocumentSignature(payload, signatureHash, secret = 'trippo-doc-signature') {
  const expected = signDocumentPayload(payload, secret);
  return expected === signatureHash;
}
