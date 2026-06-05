import rateLimit from 'express-rate-limit';

function jsonRateLimit({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        detail: message
      });
    }
  });
}

export const licenseValidationLimiter = jsonRateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: 'Too many licence checks. Please wait a few minutes and try again.'
});

export const billingPortalLimiter = jsonRateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  message: 'Too many billing portal requests. Please wait a few minutes and try again.'
});

export const adminLimiter = jsonRateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: 'Too many admin requests. Please wait a few minutes and try again.'
});

export const stripeWebhookLimiter = jsonRateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  message: 'Too many webhook requests.'
});
