import crypto from 'crypto';

/** Coerce MongoDB Binary / Buffer-like values into a Node Buffer. */
export function toNodeBuffer(data) {
  if (data == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data);
  // mongoose / bson Binary
  if (typeof data.value === 'function') {
    const value = data.value(true);
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }
  if (Buffer.isBuffer(data.buffer)) return data.buffer;
  if (data.buffer instanceof ArrayBuffer) {
    return Buffer.from(data.buffer, data.byteOffset || 0, data.byteLength ?? data.length);
  }
  return Buffer.from(data);
}

export function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(toNodeBuffer(buffer)).digest('hex');
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
