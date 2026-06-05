import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { auditEvent } from './securityAudit.js';

function jsonRateLimit({ windowMs, limit, code = 'RATE_LIMITED', message, keyGenerator, skip }) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    skip,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      auditEvent(req, 'rate_limited', { code });
      res.status(429).json({
        ok: false,
        allowed: false,
        code,
        detail: message
      });
    }
  });
}

function licenceKeyFromRequest(req) {
  const value = req.body?.licenseKey;
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function hashedLicenceKey(value) {
  return createHash('sha256').update(value).digest('hex');
}

export const licenseValidationLimiter = jsonRateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  code: 'IP_RATE_LIMITED',
  message: 'Too many licence checks from this network. Please wait a few minutes and try again.'
});

export const licenseKeyValidationLimiter = jsonRateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  code: 'LICENSE_RATE_LIMITED',
  message: 'This licence key has been checked too many times. Please wait a few minutes and try again.',
  skip: (req) => !licenceKeyFromRequest(req),
  keyGenerator: (req) => `licence:${hashedLicenceKey(licenceKeyFromRequest(req))}`
});

export const billingPortalLimiter = jsonRateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  code: 'BILLING_RATE_LIMITED',
  message: 'Too many billing portal requests. Please wait a few minutes and try again.'
});

export const billingPortalLicenceLimiter = jsonRateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 4,
  code: 'BILLING_LICENSE_RATE_LIMITED',
  message: 'Billing has been opened too many times for this licence. Please wait a few minutes and try again.',
  skip: (req) => !licenceKeyFromRequest(req),
  keyGenerator: (req) => `billing:${hashedLicenceKey(licenceKeyFromRequest(req))}`
});

export const adminLimiter = jsonRateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  code: 'ADMIN_RATE_LIMITED',
  message: 'Too many admin requests. Please wait a few minutes and try again.'
});

export const stripeWebhookLimiter = jsonRateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  code: 'WEBHOOK_RATE_LIMITED',
  message: 'Too many webhook requests.'
});
