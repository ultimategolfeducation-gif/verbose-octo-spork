# ForceMap Subscription Email Flow

Last reviewed: 2026-07-12

Latest MailerSend/DNS verification: 2026-07-12

## Current Infrastructure

ForceMap subscriptions are sold through Stripe Payment Links for the ForceMap Monthly and Annual prices. Stripe sends `checkout.session.completed` and subscription/invoice events to the licensing backend at:

```text
https://license.ultimategolfeducation.com/webhooks/stripe
```

The backend creates and updates Keygen licences. Keygen licence metadata is the customer/subscription mapping store; there is no separate database.

The desktop app does not create subscriptions and does not send subscription emails. It validates licence keys against the backend.

The live backend health endpoint is:

```text
https://license.ultimategolfeducation.com/health
```

Local check on 2026-07-10 returned `200` with `{"ok":true,"service":"forcemap-licensing"}`.

## Stripe Account And Environment

The live Stripe dashboard tab verified on 2026-07-12 was for:

```text
Account ID: acct_1TcwffFG9BzhxLgm
Dashboard title: Ultimate Golf Education - Stripe
URL mode observed: live dashboard URL, not /test/
```

Previous ForceMap handoff notes identify this as the Ultimate Golf Education/ForceMap billing setup with:

```text
Product: ForceMap™ by Ultimate Golf Education
Monthly: forcemap_monthly, US$49.95/month
Annual: forcemap_annual, US$499.95/year
```

Configure test-mode and live-mode settings separately.

Live Stripe customer email settings changed and rechecked on 2026-07-12:

```text
Subscriptions and emails:
- Send a reminder email 7 days before a trial ends: off
- Send emails about upcoming renewals: off
- Send emails about expiring cards: changed from off to on
- Send emails when card payments fail: changed from off to on
- Send emails when bank debit payments fail: changed from off to on
- Payment method update destination: changed to Stripe-hosted payment update pages and confirmed persisted after reload
- Subscription management link: off

Business > Customer emails:
- Successful payments: changed from off to on
- Refunds: changed from off to on
- Canada PAD mandate/debit/microdeposit emails: on
- BECS Australia mandate/debit initiation emails: on
- Bacs mandate/debit initiation emails: on
- NZ BECS Direct Debit mandate/debit initiation emails: on, required by current configuration
- SEPA debit initiation emails: on, required by current configuration
- ACH Direct Debit mandate/microdeposit emails: on
- Pix payment receipts: on
- Payment completion reminders: off

Payments that require confirmation:
- Send a Stripe-hosted link for customers to confirm payments when required: attempted on, but did not persist after reload
- Send reminders if payment confirmation is not completed: attempted on with 3, 5 and 7 day reminders, but did not persist after reload
- Request 3D Secure for Billing payments that match Radar rules: left off because that changes payment behaviour, not only email ownership
```

The active ForceMap subscription products appear to use Stripe card subscriptions. Stripe now owns successful payment receipts, renewal receipts created from recurring successful payments, failed-card customer emails, failed-bank-debit customer emails, expiring-card emails and refund emails. Trial-ending and upcoming-renewal emails are intentionally off until ForceMap trials or a regulatory/business need for advance renewal notices is confirmed.

## MailerSend Account

Verified state on 2026-07-11 in the Ultimate Golf Education Chrome profile:

```text
Account/workspace: Ultimate Golf Holdings
Plan shown: Starter plan
Domain: ultimategolfeducation.com
Domain status shown by MailerSend: Verified, domain is verified and ready to use
Sender: software@ultimategolfeducation.com
Reply-To: info@ultimategolfeducation.com
API token name: ForceMap Production
API token scope: sending only, ultimategolfeducation.com
API token status: Active
Token storage: Railway environment variable only
SMTP users: none
Sender identities: none
Domain activity shown: 17 sent, 17 delivered, 0 rejected
```

The local shell does not contain MailerSend or Stripe secrets, so this review did not read the current token or make live API sends.

Because the MailerSend account is now on a paid plan, the old free-plan `Delivered by MailerSend` footer should be absent. The MailerSend domain page contains no visible sandbox-domain or `via MailerSend` wording, and the backend email payload contains only ForceMap / Ultimate Golf Education branding. Final proof still requires inspecting a received internal test email because footer insertion happens at delivery time, outside the backend HTML payload. Do not send to real customers during testing.

## Source Of Truth

Use a hybrid model.

Stripe is the source of truth for payment collection, invoices, receipts, payment recovery, card expiry, renewal reminders, trial reminders and Customer Portal links. Stripe owns these customer emails because it can include secure hosted payment/update links and avoids storing billing links or card data in ForceMap.

MailerSend/app webhooks own software-access emails only: licence delivery, access restored, access suspended and admin/security alerts.

Do not enable the same customer email in both systems.

## Email Ownership

| Event | Owner | Reason |
|---|---|---|
| New subscription / software signup confirmation | MailerSend app webhook | Includes ForceMap download URL and Keygen licence key. |
| Licence/access activated | MailerSend app webhook | Covered by the welcome/licence email after Stripe checkout provisioning. |
| Payment succeeded / receipt | Stripe | Stripe receipt/invoice email is authoritative and compliant. |
| Subscription renewed | Stripe | Renewal payment creates Stripe invoice/receipt. |
| Payment failed | Stripe | Stripe can include secure recovery/update-payment links. |
| Payment still unresolved reminder | Stripe | Use Stripe billing/revenue recovery settings. App fallback is opt-in only. |
| Card expiring soon | Stripe | Stripe can notify one month before expiry for default payment method/source. |
| Trial ending | Stripe | Stripe supports trial-ending reminders. Confirm trials exist before enabling. |
| Subscription cancelled | Stripe for billing cancellation; MailerSend for ForceMap access date if needed | Stripe owns billing cancellation. App email explains licence access end date when cancellation is recorded. |
| Licence/access interrupted or paused after failed payment grace | MailerSend app webhook | This is software access state, not payment collection. |
| Access restored after successful payment | MailerSend app webhook | Confirms ForceMap licence validation should work again. |
| Abuse/admin licence alerts | MailerSend app webhook | Internal operational alert only. |

## Backend Changes In This Review

- MailerSend emails now send both plain-text and simple branded HTML bodies.
- The HTML contains ForceMap and Ultimate Golf Education branding and no MailerSend footer or third-party branding.
- `APP_BILLING_EMAILS_ENABLED=false` is the default. This keeps app-side failed-payment/reminder emails off when Stripe owns billing emails.
- `invoice.payment_succeeded` is now handled so a previously interrupted licence can be reinstated and the customer can receive a ForceMap access-restored email.
- `invoice.payment_action_required` is handled internally so the licence enters the same grace-period state without sending duplicate app billing email.
- `charge.refunded` is handled internally so refund metadata is recorded on the licence without changing access or sending a duplicate app billing email.
- Stripe event IDs are stored in Keygen metadata for relevant webhook updates.
- Additional subscription lifecycle events are accepted by the webhook: paused, resumed, pending update applied and pending update expired.

## Required Environment Variables

Set these in Railway. Do not commit or paste live values.

```text
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_BILLING_RETURN_URL=https://ultimategolfeducation.com

KEYGEN_ACCOUNT_ID=
KEYGEN_PRODUCT_ID=
KEYGEN_POLICY_ID=
KEYGEN_API_TOKEN=

MAILERSEND_API_TOKEN=
MAILERSEND_FROM_EMAIL=software@ultimategolfeducation.com
MAILERSEND_FROM_NAME=ForceMap™ by Ultimate Golf Education
MAILERSEND_REPLY_TO_EMAIL=info@ultimategolfeducation.com
MAILERSEND_REPLY_TO_NAME=Ultimate Golf Education
APP_BILLING_EMAILS_ENABLED=false
ABUSE_ALERT_EMAIL=info@ultimategolfeducation.com

DOWNLOAD_URL=https://info.forcemap.com.au/forcemap-download
ADMIN_API_TOKEN=
TASK_API_TOKEN=
```

Use `APP_BILLING_EMAILS_ENABLED=true` only as a temporary fallback if Stripe customer emails are not configured yet. Leave it `false` for the clean production flow.

## Stripe Dashboard Setup

In the Ultimate Golf Education Stripe account, configure live mode and test mode separately.

Recommended live-mode customer email settings:

```text
Enable successful payment receipts.
Enable failed card payment emails.
Enable reminders for unresolved subscription invoices if using Stripe reminders.
Enable card-expiry emails.
Enable upcoming-renewal emails if required for the subscription plans or regions sold into.
Enable trial-ending emails only if ForceMap trials exist.
Enable subscription-management links through the Stripe Customer Portal.
Use Stripe branding and a verified custom email domain if available.
```

Stripe webhook endpoint should subscribe to:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.subscription.pending_update_applied
customer.subscription.pending_update_expired
invoice.payment_failed
invoice.payment_action_required
invoice.payment_succeeded
charge.refunded
```

Do not rely on `customer.source.expiring` for modern PaymentMethod-based subscriptions. Stripe documents it as a legacy Card/Source event. Use Stripe's built-in expiring-card customer email setting instead.

Final live-mode ownership/settings after this pass:

```text
Stripe owns:
- Initial and renewal successful payment receipts: enabled through Business > Customer emails > Successful payments.
- Refund receipts: enabled through Business > Customer emails > Refunds.
- Failed card payments: enabled through Billing > Subscriptions and emails.
- Failed bank debit payments: enabled through Billing > Subscriptions and emails.
- Expiring cards: enabled through Billing > Subscriptions and emails.
- Direct debit mandate/debit initiation emails: already enabled or required by Stripe configuration.
- Pix payment receipts: already enabled.

Stripe settings intentionally left disabled:
- Trial-ending email: off because no current ForceMap trial flow was confirmed.
- Upcoming-renewal email: off to avoid extra monthly renewal noise while receipts already cover successful renewals.
- Recurring invoice unpaid reminders: off for customer-sent manual invoices, not the current ForceMap card subscription flow.
- Payment confirmation email/reminders: attempted but did not persist while 3D Secure rules remain off.
```

Manual Stripe follow-up:

```text
1. Stripe-hosted payment-method update links are enabled and should remain the default unless a custom billing portal is built.
2. If payment authentication emails are required, review the 3D Secure/Radar behaviour first, then enable the Stripe-hosted confirmation email setting and confirm it persists after reload.
3. Consider adding a Stripe custom email domain if billing emails should use a UGE sending domain instead of Stripe's default stripe.com sending domain.
4. Stripe public support email currently shows ultimategolfeducation@gmail.com on the Customer emails page. Change this in Public details if replies should go to info@ultimategolfeducation.com.
```

## MailerSend Dashboard Setup

Confirmed:

```text
Account plan is paid.
Domain ultimategolfeducation.com is verified/authenticated.
MAILERSEND_API_TOKEN is sending-only and scoped to ultimategolfeducation.com.
software@ultimategolfeducation.com is allowed as the sender address.
Reply-To is info@ultimategolfeducation.com.
Track opens is enabled.
Track clicks is enabled.
Track with customized link name is enabled.
Track content is disabled so sent email bodies are not stored in MailerSend activity.
Track unsubscribes is disabled so MailerSend does not inject unsubscribe links into transactional emails.
```

Public DNS confirmed:

```text
SPF: ultimategolfeducation.com TXT includes include:_spf.mailersend.net
DKIM: mlsend2._domainkey.ultimategolfeducation.com CNAME mlsend2._domainkey.mailersend.net
Return-Path: mta.ultimategolfeducation.com CNAME mailersend.net
DMARC: _dmarc.ultimategolfeducation.com TXT v=DMARC1; p=none; rua=mailto:postmaster@ultimategolfeducation.com; fo=1;
Custom tracking: email.ultimategolfeducation.com CNAME links.mailersend.net
```

The custom tracking record was added in VIPControl on 2026-07-11 without editing existing records:

```text
Type: CNAME
Host/name: email
FQDN: email.ultimategolfeducation.com
Value/target: links.mailersend.net
TTL: 3600
```

Authoritative DNS check against `ns1.nameserver.net.au` returned the CNAME immediately after the change. Google DNS (`8.8.8.8`) and Cloudflare DNS (`1.1.1.1`) also returned the CNAME on 2026-07-11. The local default resolver still returned the previous NXDOMAIN response immediately after the change, so some caches may lag while they expire.

MailerSend accepted `Verify & Save` for the custom subdomain and showed `Tracking updated`. With click tracking enabled and the custom link name enabled, tracked recipient-visible links use the UGE host `email.ultimategolfeducation.com` instead of a MailerSend tracking host.

## Testing

Use Stripe test mode before live mode.

1. Set test-mode Stripe secret and webhook secret in a non-production Railway/local environment.
2. Keep `APP_BILLING_EMAILS_ENABLED=false`.
3. Forward Stripe CLI test events to:

```text
http://localhost:3000/webhooks/stripe
```

4. Run a test checkout with an internal UGE email address.
5. Confirm exactly one ForceMap welcome email arrives from `software@ultimategolfeducation.com`.
6. Confirm the welcome email includes the download URL, licence key, reply-to and UGE signature.
7. Confirm no `Delivered by MailerSend` footer appears.
8. Trigger `invoice.payment_failed` in Stripe test mode and confirm Stripe, not MailerSend, owns the failed-payment email.
9. Trigger `invoice.payment_succeeded` after a failed-payment state and confirm the app sends at most one access-restored email.
10. Confirm card-expiry and trial-ending tests through Stripe's own test tooling/settings where available.
11. Confirm Keygen metadata updates without exposing full licence keys in logs or screenshots.
12. Confirm production Railway variables still point to live Stripe keys, not test keys, before deployment.

Local code test:

```text
npm test
```

Local test result on 2026-07-12:

```text
39 tests passing after webhook, refund and ForceMap-owned template coverage updates.
```

Live inbox test status:

```text
Not completed from the local machine in this pass because the local shell has no MailerSend API token, no Railway CLI access, no ADMIN_API_TOKEN/TASK_API_TOKEN and no safe existing backend secret source. The ForceMap app-owned templates were verified at payload/test level only. Send live internal tests from the production backend or a temporary send-only MailerSend token, then inspect the received inbox before declaring final delivery proof.
```

## Manual Work Still Needed

- Send one internal test email from the paid MailerSend account or production backend for each ForceMap-owned customer template and visually confirm sender, reply-to, signature, HTML rendering, plain-text fallback and no MailerSend footer in the received message.
- Confirm Stripe test-mode settings separately.
- Confirm whether ForceMap actually uses trials. If not, leave trial-ending emails off.
- Confirm whether Stripe custom email domain is configured for billing emails. If not, add it only after DNS impact is reviewed.

## ForceMap-Owned Customer Email Copy

All app-owned customer emails use:

```text
Sender: ForceMap™ by Ultimate Golf Education <software@ultimategolfeducation.com>
Reply-To: Ultimate Golf Education <info@ultimategolfeducation.com>
Formats: HTML and plain text
MailerSend branding in source payload: none found
```

Welcome and licence key:

```text
Trigger: checkout.session.completed provisions a new Keygen licence, or an admin resend/reissue sends the existing licence.
Subject: Welcome to ForceMap™ by Ultimate Golf Education

Welcome to ForceMap™ by Ultimate Golf Education.

Your ForceMap licence is ready. Download the installer here:
{DOWNLOAD_URL}

Licence key:
{LICENSE_KEY}

Keep this licence key somewhere safe. You will need it when you activate ForceMap on a computer.

Regards,

Ultimate Golf Education

ForceMap™ software support

info@ultimategolfeducation.com
```

Cancellation access-end notice:

```text
Trigger: customer.subscription.updated or related subscription event where cancel_at_period_end is true and the access-end date has not already been emailed.
Subject: ForceMap access after cancellation

Your ForceMap subscription cancellation has been recorded.

Your ForceMap licence remains active until:
{ACCESS_ENDS_AT}

After that date, the licence will be suspended. To use ForceMap again later, restart your subscription or contact support.

Regards,

Ultimate Golf Education

ForceMap™ software support

info@ultimategolfeducation.com
```

Licence suspended:

```text
Trigger: scheduled process-due-actions suspends a licence after the existing unpaid grace period expires.
Subject: ForceMap access suspended

Your ForceMap licence has been suspended because the subscription payment remains unresolved after the grace period.

To restore access, update your payment details through Stripe or contact support.

Regards,

Ultimate Golf Education

ForceMap™ software support

info@ultimategolfeducation.com
```

Licence restored:

```text
Trigger: invoice.payment_succeeded restores a licence that was in payment failure, grace-period or suspended access.
Subject: ForceMap access restored

Your ForceMap access has been restored.

Your licence should validate normally the next time ForceMap checks in. If ForceMap is already open, restart the app or run a fresh licence check.

Regards,

Ultimate Golf Education

ForceMap™ software support

info@ultimategolfeducation.com
```

## Long-Term Template Management

Recommended next structure is a hybrid MailerSend-template model:

```text
The app controls triggers, idempotency, licence state, required variables and fallback content.
MailerSend controls editable ForceMap email design and wording.
Stripe remains responsible for billing email content and secure hosted billing links.
```

Recommended MailerSend template IDs:

```text
forcemap-welcome-license
forcemap-cancellation-access-end
forcemap-license-suspended
forcemap-license-restored
```

Required variables:

```text
forcemap-welcome-license:
- customer_name
- license_key
- download_url
- support_email
- product_name

forcemap-cancellation-access-end:
- customer_name
- access_end_date
- support_email
- product_name

forcemap-license-suspended:
- customer_name
- billing_portal_url or billing_update_url when available
- support_email
- product_name

forcemap-license-restored:
- customer_name
- support_email
- product_name
```

Do not migrate live sends until each MailerSend template has fallback copy in code, a preview/test-send checklist, version notes and a received-inbox proof that no MailerSend footer, badge, logo, sandbox wording or third-party tracking host is visible.
