import {
  createLicense,
  findLicenseByMetadata,
  reinstateLicense,
  suspendLicense,
  updateLicenseMetadata
} from './clients/keygenClient.js';
import { retrieveCustomer, retrieveInvoice, retrieveSubscription } from './clients/stripeClient.js';
import { getConfig } from './config.js';
import {
  buildFailureWindow,
  getProductTypeFromSubscription,
  scheduledCancellationAtSeconds,
  secondsToIso,
  subscriptionPeriodEndSeconds,
  subscriptionAccessPatch
} from './subscriptionPolicy.js';
import {
  sendAccessRestoredEmail,
  sendCancellationEmail,
  sendPaymentFailedEmail,
  sendPaymentReminderEmail,
  sendSuspendedEmail,
  sendWelcomeEmail
} from './email.js';

function customerEmailFromSession(session, customer) {
  return (
    session.customer_details?.email ||
    session.customer_email ||
    customer?.email ||
    session.metadata?.email
  )?.toLowerCase();
}

export function customerNameFromSession(session, customer) {
  return (
    session.customer_details?.name ||
    customer?.name ||
    session.metadata?.name ||
    ''
  );
}

function subscriptionIdFromSession(session) {
  return typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;
}

function customerIdFromSession(session) {
  return typeof session.customer === 'string' ? session.customer : session.customer?.id;
}

function billingEmailsEnabled() {
  return getConfig().appBillingEmailsEnabled;
}

function subscriptionIdFromInvoice(invoice) {
  return typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;
}

function invoiceIdFromCharge(charge) {
  return typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
}

export async function provisionLicenseFromCheckout(session) {
  const subscriptionId = subscriptionIdFromSession(session);
  const customerId = customerIdFromSession(session);

  if (!subscriptionId || !customerId) {
    throw new Error('Checkout session does not include a subscription and customer.');
  }

  const [subscription, customer] = await Promise.all([
    retrieveSubscription(subscriptionId),
    retrieveCustomer(customerId)
  ]);
  const email = customerEmailFromSession(session, customer);

  if (!email) {
    throw new Error('Checkout session does not include a customer email.');
  }

  const existing = await findLicenseByMetadata('stripeSubscriptionId', subscriptionId);
  if (existing) {
    if (!existing.attributes?.metadata?.welcomeEmailSentAt) {
      await sendWelcomeEmail({
        email,
        licenseKey: existing.attributes.key
      });
      await updateLicenseMetadata(existing, {
        welcomeEmailSentAt: new Date().toISOString()
      });
    }
    return { license: existing, created: false };
  }

  const price = subscription.items?.data?.[0]?.price;
  const productType = getProductTypeFromSubscription(subscription);

  const metadata = {
    app: 'ForceMap',
    customerName: customerNameFromSession(session, customer),
    customerEmail: email,
    productType,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripeCheckoutSessionId: session.id,
    stripePriceId: price?.id || '',
    stripeProductId:
      typeof price?.product === 'string' ? price.product : price?.product?.id || '',
    stripeSubscriptionStatus: subscription.status,
    stripeCurrentPeriodEnd: secondsToIso(subscriptionPeriodEndSeconds(subscription)) || '',
    accessStatus: 'active',
    paymentFailureOpen: 'false',
    cancellationPending: String(Boolean(scheduledCancellationAtSeconds(subscription))),
    createdBy: 'stripe.checkout.session.completed',
    createdAt: new Date().toISOString()
  };

  const created = await createLicense({ email, metadata });
  const license = created.data;

  await updateLicenseMetadata(license, {
    keygenLicenseId: license.id
  });

  await sendWelcomeEmail({
    email,
    licenseKey: license.attributes.key
  });

  await updateLicenseMetadata(license, {
    welcomeEmailSentAt: new Date().toISOString()
  });

  return { license, created: true };
}

export async function applySubscriptionState(subscription, eventType, eventId = '') {
  const license = await findLicenseByMetadata('stripeSubscriptionId', subscription.id);
  if (!license) {
    return { found: false };
  }

  const patch = subscriptionAccessPatch(subscription);
  const email = license.attributes?.metadata?.customerEmail;
  const metadata = license.attributes?.metadata || {};

  if (subscription.status === 'past_due' && metadata.paymentFailureOpen === 'true') {
    patch.paymentFailureStartedAt = metadata.paymentFailureStartedAt;
    patch.paymentReminderDueAt = metadata.paymentReminderDueAt;
    patch.paymentSuspendDueAt = metadata.paymentSuspendDueAt;
  }

  if (patch.accessStatus === 'active' && license.attributes?.suspended) {
    await reinstateLicense(license.id);
  }

  if (patch.accessStatus === 'suspended' && !license.attributes?.suspended) {
    await suspendLicense(license.id);
  }

  const cancellationAt = scheduledCancellationAtSeconds(subscription);
  if (cancellationAt && email) {
    const accessEndsAt = secondsToIso(cancellationAt);
    if (metadata.cancellationEmailSentForAccessEndsAt !== accessEndsAt) {
      await sendCancellationEmail({ email, accessEndsAt });
      patch.cancellationEmailSentForAccessEndsAt = accessEndsAt;
      patch.cancellationEmailSentAt = new Date().toISOString();
    }
  }

  if (
    billingEmailsEnabled() &&
    subscription.status === 'past_due' &&
    email &&
    !metadata.paymentPastDueEmailSentAt
  ) {
    await sendPaymentReminderEmail({ email });
    patch.paymentPastDueEmailSentAt = new Date().toISOString();
  }

  const updated = await updateLicenseMetadata(license, {
    ...patch,
    lastStripeEventType: eventType,
    lastStripeEventId: eventId
  });

  return { found: true, license: updated.data };
}

export async function handlePaymentFailed(invoice, eventId = '') {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) {
    return { found: false };
  }

  const license = await findLicenseByMetadata('stripeSubscriptionId', subscriptionId);
  if (!license) {
    return { found: false };
  }

  const metadata = license.attributes?.metadata || {};
  const email = metadata.customerEmail;
  const now = new Date();
  const sendAppBillingEmail = billingEmailsEnabled();
  const failureWindow =
    metadata.paymentFailureOpen === 'true'
      ? {
          paymentFailureOpen: 'true',
          paymentFailureStartedAt: metadata.paymentFailureStartedAt,
          paymentReminderDueAt: metadata.paymentReminderDueAt,
          paymentSuspendDueAt: metadata.paymentSuspendDueAt
        }
      : buildFailureWindow(now);

  if (sendAppBillingEmail && email && !metadata.paymentFailedEmailSentAt) {
    await sendPaymentFailedEmail({ email });
  }

  await reinstateLicense(license.id);

  const updated = await updateLicenseMetadata(license, {
    ...failureWindow,
    accessStatus: 'grace_period',
    lastStripeEventType: 'invoice.payment_failed',
    lastStripeEventId: eventId,
    lastPaymentFailedInvoiceId: invoice.id || '',
    paymentFailedEmailSentAt: sendAppBillingEmail
      ? metadata.paymentFailedEmailSentAt || now.toISOString()
      : metadata.paymentFailedEmailSentAt || ''
  });

  return { found: true, license: updated.data };
}

export async function handlePaymentActionRequired(invoice, eventId = '') {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) {
    return { found: false };
  }

  const license = await findLicenseByMetadata('stripeSubscriptionId', subscriptionId);
  if (!license) {
    return { found: false };
  }

  const metadata = license.attributes?.metadata || {};
  const now = new Date();
  const failureWindow =
    metadata.paymentFailureOpen === 'true'
      ? {
          paymentFailureOpen: 'true',
          paymentFailureStartedAt: metadata.paymentFailureStartedAt,
          paymentReminderDueAt: metadata.paymentReminderDueAt,
          paymentSuspendDueAt: metadata.paymentSuspendDueAt
        }
      : buildFailureWindow(now);

  await reinstateLicense(license.id);

  const updated = await updateLicenseMetadata(license, {
    ...failureWindow,
    accessStatus: 'grace_period',
    lastStripeEventType: 'invoice.payment_action_required',
    lastStripeEventId: eventId,
    lastPaymentActionRequiredInvoiceId: invoice.id || ''
  });

  return { found: true, license: updated.data };
}

export async function handlePaymentSucceeded(invoice, eventId = '') {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) {
    return { found: false };
  }

  const license = await findLicenseByMetadata('stripeSubscriptionId', subscriptionId);
  if (!license) {
    return { found: false };
  }

  const metadata = license.attributes?.metadata || {};
  const invoiceId = invoice.id || eventId;
  const hadInterruptedAccess =
    metadata.paymentFailureOpen === 'true' ||
    metadata.accessStatus === 'grace_period' ||
    metadata.accessStatus === 'suspended';
  const subscription = await retrieveSubscription(subscriptionId);
  const patch = subscriptionAccessPatch(subscription);
  const restoredToActive = patch.accessStatus === 'active';

  if (restoredToActive) {
    await reinstateLicense(license.id);
  }

  if (
    restoredToActive &&
    hadInterruptedAccess &&
    metadata.customerEmail &&
    metadata.accessRestoredEmailSentForInvoiceId !== invoiceId
  ) {
    await sendAccessRestoredEmail({ email: metadata.customerEmail });
    patch.accessRestoredEmailSentForInvoiceId = invoiceId;
    patch.accessRestoredEmailSentAt = new Date().toISOString();
  }

  const updated = await updateLicenseMetadata(license, {
    ...patch,
    ...(restoredToActive
      ? {
          paymentFailureOpen: 'false',
          paymentFailureStartedAt: '',
          paymentReminderDueAt: '',
          paymentSuspendDueAt: '',
          paymentFailedEmailSentAt: '',
          paymentPastDueEmailSentAt: '',
          paymentReminderEmailSentAt: '',
          paymentSuspendedEmailSentAt: ''
        }
      : {}),
    lastStripeEventType: 'invoice.payment_succeeded',
    lastStripeEventId: eventId,
    lastPaymentSucceededInvoiceId: invoiceId
  });

  return { found: true, license: updated.data };
}

export async function handleChargeRefunded(charge, eventId = '') {
  const invoiceId = invoiceIdFromCharge(charge);
  if (!invoiceId) {
    return { found: false };
  }

  const invoice = await retrieveInvoice(invoiceId);
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) {
    return { found: false };
  }

  const license = await findLicenseByMetadata('stripeSubscriptionId', subscriptionId);
  if (!license) {
    return { found: false };
  }

  const updated = await updateLicenseMetadata(license, {
    lastStripeEventType: 'charge.refunded',
    lastStripeEventId: eventId,
    lastRefundedChargeId: charge.id || '',
    lastRefundedInvoiceId: invoiceId,
    lastRefundedPaymentIntentId:
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id || '',
    lastRefundAmount: String(charge.amount_refunded ?? charge.amount ?? ''),
    lastRefundCurrency: charge.currency || '',
    lastRefundedAt: new Date().toISOString()
  });

  return { found: true, license: updated.data };
}

export async function processDueLicenseActions(now = new Date()) {
  const failureLicenses = await import('./clients/keygenClient.js').then((client) =>
    client.listLicensesByMetadata('paymentFailureOpen', 'true')
  );
  const cancellationLicenses = await import('./clients/keygenClient.js').then((client) =>
    client.listLicensesByMetadata('cancellationPending', 'true')
  );

  const results = {
    remindersSent: 0,
    paymentSuspensions: 0,
    cancellationSuspensions: 0
  };

  for (const license of failureLicenses.data || []) {
    const metadata = license.attributes?.metadata || {};
    const email = metadata.customerEmail;
    const reminderDue =
      metadata.paymentReminderDueAt &&
      new Date(metadata.paymentReminderDueAt).getTime() <= now.getTime();
    const suspendDue =
      metadata.paymentSuspendDueAt &&
      new Date(metadata.paymentSuspendDueAt).getTime() <= now.getTime();

    if (
      billingEmailsEnabled() &&
      email &&
      reminderDue &&
      !suspendDue &&
      !metadata.paymentReminderEmailSentAt
    ) {
      await sendPaymentReminderEmail({ email });
      await updateLicenseMetadata(license, {
        paymentReminderEmailSentAt: now.toISOString()
      });
      results.remindersSent += 1;
    }

    if (suspendDue) {
      if (!license.attributes?.suspended) {
        await suspendLicense(license.id);
      }
      if (email && !metadata.paymentSuspendedEmailSentAt) {
        await sendSuspendedEmail({ email });
      }
      await updateLicenseMetadata(license, {
        accessStatus: 'suspended',
        paymentFailureOpen: 'false',
        paymentSuspendedEmailSentAt:
          metadata.paymentSuspendedEmailSentAt || now.toISOString()
      });
      results.paymentSuspensions += 1;
    }
  }

  for (const license of cancellationLicenses.data || []) {
    const metadata = license.attributes?.metadata || {};
    const due =
      metadata.cancelAccessAt && new Date(metadata.cancelAccessAt).getTime() <= now.getTime();
    if (!due) {
      continue;
    }

    if (!license.attributes?.suspended) {
      await suspendLicense(license.id);
    }
    await updateLicenseMetadata(license, {
      accessStatus: 'suspended',
      cancellationPending: 'false'
    });
    results.cancellationSuspensions += 1;
  }

  return results;
}
