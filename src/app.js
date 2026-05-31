import express from 'express';
import { adminRouter } from './routes/admin.js';
import { stripeWebhookRouter } from './routes/stripeWebhook.js';
import { validationRouter } from './routes/validation.js';

export function createApp() {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'forcemap-licensing' });
  });

  app.use('/webhooks/stripe', stripeWebhookRouter);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/license', validationRouter);
  app.use('/admin', adminRouter);

  app.use((error, _req, res, _next) => {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({
      error: error.message || 'Unexpected server error.',
      details: error.details
    });
  });

  return app;
}
