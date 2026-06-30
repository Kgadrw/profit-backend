import { authenticateUser } from './auth.js';

/** Allow X-User-Id auth or ?access= signed token (for img/video tags). */
export async function authenticateFileAccess(req, res, next) {
  if (req.query.access) {
    req.fileAccessToken = String(req.query.access);
    return next();
  }
  return authenticateUser(req, res, next);
}
