import express from 'express';
import { adminRouter } from './routes/admin.js';
import { stripeWebhookRouter } from './routes/stripeWebhook.js';
import { validationRouter } from './routes/validation.js';
import {
  adminLimiter,
  billingPortalLicenceLimiter,
  billingPortalLimiter,
  licenseKeyValidationLimiter,
  licenseValidationLimiter,
  stripeWebhookLimiter
} from './rateLimits.js';
import { errorSummary } from './securityAudit.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'forcemap-licensing' });
  });

  app.use('/webhooks/stripe', stripeWebhookLimiter, stripeWebhookRouter);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/license/validate', licenseKeyValidationLimiter, licenseValidationLimiter);
  app.use('/api/license/billing-portal', billingPortalLicenceLimiter, billingPortalLimiter);
  app.use('/api/license', validationRouter);
  app.use('/admin', adminLimiter, adminRouter);

  app.use((error, _req, res, _next) => {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error('[security] server_error', JSON.stringify(errorSummary(error)));
    }
    res.status(status).json({
      error: status >= 500 ? 'Unexpected server error.' : error.message
    });
  });

  return app;
}
