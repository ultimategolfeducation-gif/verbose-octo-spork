import { getConfig } from './config.js';
import { HttpError } from './errors.js';

function readBearerToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token;
}

export function requireAdmin(req, _res, next) {
  const token = readBearerToken(req);
  if (!token || token !== getConfig().adminApiToken) {
    throw new HttpError(401, 'Admin API token is required.');
  }
  next();
}

export function requireTaskToken(req, _res, next) {
  const token = readBearerToken(req);
  if (!token || token !== getConfig().taskApiToken) {
    throw new HttpError(401, 'Task API token is required.');
  }
  next();
}
