# ForceMap Licensing Backend Rules

## Security Baseline

- Keep Stripe, Keygen, MailerSend, Railway, admin, and task secrets server-side only.
- Never add live API keys, webhook secrets, admin tokens, payment data, full licence keys, or customer passwords to commits, package files, logs, screenshots, handoffs, or chat.
- The desktop app may send a licence key and machine fingerprint for validation, but it must not contain Stripe secret keys, Keygen admin/API tokens, MailerSend tokens, admin tokens, or task tokens.
- Do not trust client-submitted payment, subscription, role, expiry, machine-limit, or admin status. Those values must come from Stripe, Keygen, or protected backend logic.
- Use Australian spelling in the desktop app UI where appropriate: noun `licence`, verb `license`.

## Access Control Matrix

| Role | Can Do | Cannot Do |
|---|---|---|
| Public visitor | Reach public marketing/download pages outside this backend. Hit `/health`. Submit Stripe checkout through Stripe-hosted/payment-link flows. | Create, extend, modify, or validate licences directly. Access admin routes. Call Stripe/Keygen/MailerSend secrets. |
| Trial user | Use trial/beta access only when represented by a valid Stripe/Keygen state. Validate a legitimate issued licence from the desktop app. | Self-grant paid access, bypass machine limits, change expiry, create staff licences, or call admin endpoints. |
| Paid active user | Activate ForceMap on allowed devices. Validate saved licence. Open Stripe Customer Portal for their own paid licence. Continue during temporary backend outages within offline grace. | Modify subscription state from the desktop app. Extend cancellation/expiry through offline grace. Manage another customer. Create licences. |
| Expired/cancelled user | Use ForceMap only until the server-side paid access end date. Reopen billing through supported Stripe flows if eligible. | Continue past access end using offline grace. Activate new devices after suspension. Access paid features once Keygen is suspended/expired. |
| Admin | Use bearer-token protected admin endpoints to resend welcome emails, reissue licences, suspend/reactivate licences, reset activations, and view customer status. | Use public routes for admin actions. Expose admin tokens. Log full licence keys or secrets. Bypass Stripe/Keygen source-of-truth checks. |
| Stripe webhook | Send signed Stripe events to `/webhooks/stripe`. Provision/update/suspend licences based on verified Stripe events. Retry events safely. | Act without valid Stripe signature. Trust client-submitted payment status. Create duplicate licences for duplicate events. |
| Desktop app client | Send licence key, machine fingerprint, machine name, platform, and activate flag to backend validation. Request billing portal for the saved paid licence. Use local offline grace after successful validation. | Hold backend secrets. Create/update/suspend licences. Fake paid status, expiry, plan, cancellation, or machine limits. Access admin routes. |

## Backend Rules

- Public JSON endpoints must reject unexpected fields and enforce type/length/allowed-value checks before calling Stripe, Keygen, MailerSend, or admin workflows.
- Stripe webhooks must use signature verification with the raw request body.
- Duplicate Stripe checkout events must not create duplicate licences; use the Stripe subscription ID as the idempotency key.
- Rate limits must remain per endpoint and include both IP-based and licence-key-based limits where the endpoint accepts a licence key.
- Logs may include masked hashes and event codes only. Do not log full licence keys, API tokens, payment card details, webhook payloads, or sensitive customer data.
- Existing desktop users with a recently validated licence should keep working during temporary backend outage/rate-limit pressure, but offline grace must not extend cancelled or expired access.
- Any live alerting/monitoring gaps should be written as explicit TODOs until configured.
