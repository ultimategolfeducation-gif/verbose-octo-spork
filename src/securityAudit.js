import { createHash } from 'node:crypto';

export function hashValue(value) {
  const text = String(value || '').trim();
  return text ? createHash('sha256').update(text).digest('hex').slice(0, 12) : '';
}

export function clientIp(req) {
  return req.ip || req.get?.('x-forwarded-for')?.split(',')[0]?.trim() || '';
}

export function auditEvent(req, event, fields = {}) {
  const safeFields = {
    ip: clientIp(req),
    ...fields
  };
  console.log(`[security] ${event} ${JSON.stringify(safeFields)}`);
}

export function licenseHash(value) {
  return hashValue(String(value || '').toUpperCase());
}

export function customerHash(value) {
  return hashValue(String(value || '').toLowerCase());
}

export function errorSummary(error) {
  const statusCode = error?.statusCode || 500;
  return {
    name: error?.name || 'Error',
    statusCode,
    message: statusCode >= 500 ? 'Unexpected server error.' : error?.message || 'Request failed.'
  };
}
