import crypto from 'crypto';

const DEFAULT_TTL_SEC = 60 * 60;

function getSecret() {
  return (
    process.env.FILE_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    'trippo-file-access-dev-only'
  );
}

export function buildFileResourceKey(kind, parts) {
  return `${kind}:${parts.join(':')}`;
}

export function createFileAccessToken(userId, resourceKey, ttlSec = DEFAULT_TTL_SEC) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${String(userId)}|${resourceKey}|${exp}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  return { token: `${encoded}.${sig}`, expiresIn: ttlSec };
}

export function verifyFileAccessToken(token, resourceKey) {
  if (!token || typeof token !== 'string') return null;

  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0) return null;

  const encoded = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  if (!encoded || !sig) return null;

  try {
    const payload = Buffer.from(encoded, 'base64url').toString('utf8');
    const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const [userId, tokenResource, expStr] = payload.split('|');
    if (!userId || !tokenResource || !expStr) return null;
    if (tokenResource !== resourceKey) return null;
    if (Math.floor(Date.now() / 1000) > Number(expStr)) return null;

    return userId;
  } catch {
    return null;
  }
}
