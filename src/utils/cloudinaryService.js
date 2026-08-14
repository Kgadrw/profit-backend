import { v2 as cloudinary } from 'cloudinary';

const DEFAULT_UPLOAD_PRESET = 'PROFIT';

function trimEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function getCloudinaryUploadPreset() {
  return trimEnv('CLOUDINARY_UPLOAD_PRESET') || DEFAULT_UPLOAD_PRESET;
}

function getCloudinaryAuth() {
  return {
    cloud_name: trimEnv('CLOUDINARY_CLOUD_NAME'),
    api_key: trimEnv('CLOUDINARY_API_KEY'),
    api_secret: trimEnv('CLOUDINARY_API_SECRET'),
  };
}

export function isCloudinaryConfigured() {
  const { cloud_name, api_key, api_secret } = getCloudinaryAuth();
  return Boolean(cloud_name && api_key && api_secret);
}

function ensureConfigured() {
  const auth = getCloudinaryAuth();
  if (!auth.cloud_name || !auth.api_key || !auth.api_secret) {
    const error = new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
    );
    error.statusCode = 503;
    throw error;
  }

  if (!/^[a-z0-9_-]+$/i.test(auth.cloud_name) || auth.cloud_name.toLowerCase() === 'root') {
    const error = new Error(
      `Invalid CLOUDINARY_CLOUD_NAME "${auth.cloud_name}". Use the cloud name from the Cloudinary dashboard (e.g. dgmexpa8v), not Root.`,
    );
    error.statusCode = 500;
    throw error;
  }

  cloudinary.config({
    cloud_name: auth.cloud_name,
    api_key: auth.api_key,
    api_secret: auth.api_secret,
    secure: true,
  });

  return auth;
}

export function isCloudinaryUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /res\.cloudinary\.com\//i.test(url) || /cloudinary\.com\//i.test(url);
}

function profilePublicId(userId) {
  return `trippo/profiles/${String(userId)}`;
}

function workspacePublicId(workspaceId) {
  return `trippo/workspaces/${String(workspaceId)}`;
}

/**
 * Upload a profile/workspace image buffer to Cloudinary.
 * Uses signed upload preset PROFIT (overwrite, no unique filename) and a
 * stable public_id so replace/delete is deterministic.
 */
export async function uploadProfileImageBuffer({
  buffer,
  kind,
  ownerId,
}) {
  const auth = ensureConfigured();

  const publicId = kind === 'workspace-profile' ? workspacePublicId(ownerId) : profilePublicId(ownerId);
  const uploadPreset = getCloudinaryUploadPreset();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        ...auth,
        upload_preset: uploadPreset,
        public_id: publicId,
        overwrite: true,
        unique_filename: false,
        use_filename: false,
        invalidate: true,
        resource_type: 'image',
        format: 'jpg',
        transformation: [
          { width: 512, height: 512, crop: 'fill', gravity: 'auto' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          version: result.version,
        });
      },
    );

    stream.end(buffer);
  });
}

export async function destroyProfileImage({ kind, ownerId, url }) {
  if (!isCloudinaryConfigured()) return;

  const auth = ensureConfigured();

  const candidates = [];
  if (kind === 'workspace-profile') {
    candidates.push(workspacePublicId(ownerId));
  } else if (kind === 'profile') {
    candidates.push(profilePublicId(ownerId));
  }

  if (url && isCloudinaryUrl(url)) {
    const parsed = publicIdFromCloudinaryUrl(url);
    if (parsed && !candidates.includes(parsed)) {
      candidates.push(parsed);
    }
  }

  for (const publicId of candidates) {
    try {
      await cloudinary.uploader.destroy(publicId, {
        ...auth,
        invalidate: true,
        resource_type: 'image',
      });
    } catch (error) {
      console.warn('Cloudinary destroy failed for', publicId, error?.message || error);
    }
  }
}

function publicIdFromCloudinaryUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/').filter(Boolean);
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx === -1) return null;

    let rest = parts.slice(uploadIdx + 1);
    // Skip transformation segments and version prefix (v123456)
    while (rest.length) {
      const segment = rest[0];
      if (/^v\d+$/.test(segment) || segment.includes(',') || segment.startsWith('t_')) {
        rest = rest.slice(1);
        continue;
      }
      break;
    }

    if (!rest.length) return null;
    const joined = rest.join('/');
    return joined.replace(/\.[a-zA-Z0-9]+$/, '');
  } catch {
    return null;
  }
}
