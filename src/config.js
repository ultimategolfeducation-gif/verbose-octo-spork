import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'KEYGEN_ACCOUNT_ID',
  'KEYGEN_PRODUCT_ID',
  'KEYGEN_POLICY_ID',
  'KEYGEN_API_TOKEN',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'DOWNLOAD_URL',
  'ADMIN_API_TOKEN'
];

export function getConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    keygenAccountId: process.env.KEYGEN_ACCOUNT_ID,
    keygenProductId: process.env.KEYGEN_PRODUCT_ID,
    keygenPolicyId: process.env.KEYGEN_POLICY_ID,
    keygenApiToken: process.env.KEYGEN_API_TOKEN,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
    smtpFrom:
      process.env.SMTP_FROM ||
      'ForceMap by Ultimate Golf Education <info@ultimategolfeducation.com>',
    downloadUrl: process.env.DOWNLOAD_URL,
    adminApiToken: process.env.ADMIN_API_TOKEN,
    taskApiToken: process.env.TASK_API_TOKEN || process.env.ADMIN_API_TOKEN
  };
}

export function assertRequiredEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
