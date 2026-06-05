import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'KEYGEN_ACCOUNT_ID',
  'KEYGEN_PRODUCT_ID',
  'KEYGEN_POLICY_ID',
  'KEYGEN_API_TOKEN',
  'MAILERSEND_API_TOKEN',
  'MAILERSEND_FROM_EMAIL',
  'DOWNLOAD_URL',
  'ADMIN_API_TOKEN'
];

export function getConfig() {
  return {
    port: Number(process.env.APP_PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    stripeBillingReturnUrl:
      process.env.STRIPE_BILLING_RETURN_URL || 'https://ultimategolfeducation.com',
    keygenAccountId: process.env.KEYGEN_ACCOUNT_ID,
    keygenProductId: process.env.KEYGEN_PRODUCT_ID,
    keygenPolicyId: process.env.KEYGEN_POLICY_ID,
    keygenApiToken: process.env.KEYGEN_API_TOKEN,
    mailerSendApiToken: process.env.MAILERSEND_API_TOKEN,
    mailerSendFromEmail: process.env.MAILERSEND_FROM_EMAIL,
    mailerSendFromName:
      process.env.MAILERSEND_FROM_NAME || 'ForceMap by Ultimate Golf Education',
    mailerSendReplyToEmail:
      process.env.MAILERSEND_REPLY_TO_EMAIL || 'info@ultimategolfeducation.com',
    mailerSendReplyToName:
      process.env.MAILERSEND_REPLY_TO_NAME || 'Ultimate Golf Education',
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
