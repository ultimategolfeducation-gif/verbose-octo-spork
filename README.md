# ForceMap Licensing Backend

This folder contains the small Stripe to Keygen licensing backend for **ForceMap by Ultimate Golf Education**.

It is intentionally separate from the current desktop capture app. The old internal `V1ProScraper` storage paths and OCR workflow are not changed by this backend.

## What It Does

- Receives Stripe webhooks from existing ForceMap Monthly and Annual subscriptions.
- Creates a Keygen license after `checkout.session.completed`.
- Stores Stripe customer/subscription/email/product metadata on the Keygen license.
- Sends the welcome email with the ForceMap download URL and license key.
- Keeps licenses active for `active`, `trialing`, and `past_due` during a 48-hour grace period.
- Suspends licenses after unpaid status, expired payment grace period, or paid-period cancellation end.
- Provides a simple validation endpoint for the ForceMap desktop app.
- Provides protected admin recovery endpoints without building an admin UI.

No PostgreSQL database is used in this first version. For under 100 active coaches, Keygen license metadata is the source of truth for the small amount of customer/license mapping needed.

## Folder Structure

```text
forcemap-licensing/
  package.json
  .env.example
  README.md
  src/
    app.js
    server.js
    config.js
    auth.js
    clients/
      keygenClient.js
      stripeClient.js
    routes/
      admin.js
      stripeWebhook.js
      validation.js
    email.js
    errors.js
    licenseWorkflow.js
    subscriptionPolicy.js
  test/
    subscriptionPolicy.test.js
```

## Environment Variables

Create these in Railway. For local testing, copy `.env.example` to `.env`.

```text
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

KEYGEN_ACCOUNT_ID=
KEYGEN_PRODUCT_ID=
KEYGEN_POLICY_ID=
KEYGEN_API_TOKEN=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

DOWNLOAD_URL=
ADMIN_API_TOKEN=
TASK_API_TOKEN=
```

`TASK_API_TOKEN` is optional and defaults to `ADMIN_API_TOKEN`. It protects the maintenance endpoint used to process delayed reminders/suspensions.

## Stripe Setup

1. Keep the existing ForceMap Monthly and ForceMap Annual subscriptions/prices in Stripe.
2. Use Stripe Payment Links from the MailerLite website.
3. In Stripe Dashboard, add a webhook endpoint:

```text
https://YOUR-RAILWAY-APP.up.railway.app/webhooks/stripe
```

4. Subscribe the endpoint to:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
```

5. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

Stripe webhook signature verification requires the raw Express request body on the webhook route. This backend keeps the raw body only for `/webhooks/stripe`.

## Keygen Setup

1. Create or use the ForceMap product in Keygen.
2. Create a license policy with the activation/device limit Mark wants.
3. Copy these IDs into Railway:

```text
KEYGEN_ACCOUNT_ID=
KEYGEN_PRODUCT_ID=
KEYGEN_POLICY_ID=
```

4. Create a Keygen API token with permissions to:

```text
license.create
license.read
license.update
license.suspend
license.reinstate
machine.read
machine.delete
```

5. Put that token in `KEYGEN_API_TOKEN`.

## Email Setup

Use any SMTP service already trusted for Ultimate Golf Education email. The welcome email sends:

```text
Subject: Welcome to ForceMap by Ultimate Golf Education

Thank you for subscribing to ForceMap by Ultimate Golf Education.

Download:
{DOWNLOAD_URL}

License Key:
{LICENSE_KEY}

Support:
info@ultimategolfeducation.com
```

## Railway Deployment

1. Push this folder to the project repository.
2. Create a new Railway service from the repo.
3. Set the Railway root directory to:

```text
forcemap-licensing
```

4. Add every environment variable from `.env.example`.
5. Railway should run:

```text
npm install
npm start
```

6. Confirm:

```text
GET https://YOUR-RAILWAY-APP.up.railway.app/health
```

returns:

```json
{ "ok": true, "service": "forcemap-licensing" }
```

## Delayed Payment And Cancellation Actions

Railway Free services may sleep, so do not rely only on the in-process hourly timer.

Add an external scheduled request once per hour from Railway cron, GitHub Actions, cron-job.org, or another simple scheduler:

```text
POST https://YOUR-RAILWAY-APP.up.railway.app/admin/tasks/process-due-actions
Authorization: Bearer TASK_API_TOKEN
```

This sends 24-hour payment reminders, suspends after 48 hours unpaid, and suspends cancelled subscriptions when the paid period has ended.

## ForceMap Desktop Validation Endpoint

ForceMap should call:

```text
POST /api/license/validate
Content-Type: application/json
```

Body:

```json
{
  "licenseKey": "CUSTOMER-LICENSE-KEY",
  "machineFingerprint": "stable-device-fingerprint",
  "machineName": "Coach laptop",
  "platform": "Windows",
  "activate": true
}
```

Successful response:

```json
{
  "allowed": true,
  "code": "VALID",
  "detail": "License is valid.",
  "licenseId": "keygen-license-id",
  "status": "ACTIVE",
  "suspended": false
}
```

Denied response:

```json
{
  "allowed": false,
  "code": "LICENSE_SUSPENDED",
  "detail": "This ForceMap license is suspended."
}
```

Recommended desktop behavior:

- Validate on first activation.
- Validate on every startup.
- Validate periodically during use, such as every 4 to 8 hours while open.
- Validate when the user activates on a new device.
- Keep a short local cache only for temporary internet outages.
- Do not embed the Keygen admin API token in the desktop app.

## Admin Endpoints

Every admin endpoint requires:

```text
Authorization: Bearer ADMIN_API_TOKEN
```

Identify a customer with one of:

```json
{ "email": "coach@example.com" }
{ "subscriptionId": "sub_..." }
{ "licenseId": "..." }
```

Endpoints:

```text
POST /admin/resend-welcome
POST /admin/reissue-license
POST /admin/suspend-license
POST /admin/reactivate-license
POST /admin/reset-activations
GET  /admin/customer-status?email=coach@example.com
GET  /admin/customer-status?subscriptionId=sub_...
GET  /admin/customer-status?licenseId=...
```

`reset-activations` deletes the Keygen machine records tied to the license, allowing the coach to activate on replacement hardware under the policy activation limit.

## Local Test Commands

```text
cd forcemap-licensing
npm install
npm test
```

For local webhook testing, use the Stripe CLI to forward events to:

```text
http://localhost:3000/webhooks/stripe
```

Then use the Stripe CLI webhook secret as `STRIPE_WEBHOOK_SECRET`.

## Official Docs Used

- Stripe webhook verification: https://docs.stripe.com/webhooks
- Stripe subscription statuses: https://docs.stripe.com/billing/subscriptions/overview
- Keygen license API: https://keygen.sh/docs/api/licenses/
- Keygen validation and activation guidance: https://keygen.sh/docs/validating-licenses/
- Keygen machines API: https://keygen.sh/docs/api/machines/
