export const GRACE_PERIOD_MS = 48 * 60 * 60 * 1000;
export const REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

export function secondsToIso(seconds) {
  if (!seconds) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

export function subscriptionPeriodEndSeconds(subscription) {
  return (
    subscription.current_period_end ||
    subscription.items?.data?.[0]?.current_period_end ||
    null
  );
}

export function scheduledCancellationAtSeconds(subscription) {
  if (subscription.status === 'canceled') {
    return null;
  }

  if (subscription.cancel_at) {
    return subscription.cancel_at;
  }

  if (subscription.cancel_at_period_end) {
    return subscriptionPeriodEndSeconds(subscription);
  }

  return null;
}

export function getProductTypeFromSubscription(subscription) {
  const price = subscription.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval;
  if (interval === 'year') {
    return 'Annual';
  }
  if (interval === 'month') {
    return 'Monthly';
  }
  return price?.nickname || price?.product?.name || 'Unknown';
}

export function buildFailureWindow(now = new Date()) {
  const startedAt = now.toISOString();
  return {
    paymentFailureOpen: 'true',
    paymentFailureStartedAt: startedAt,
    paymentReminderDueAt: new Date(now.getTime() + REMINDER_DELAY_MS).toISOString(),
    paymentSuspendDueAt: new Date(now.getTime() + GRACE_PERIOD_MS).toISOString()
  };
}

export function shouldSendDueEmail(metadata, key, now = new Date()) {
  const dueAt = metadata?.[key];
  return Boolean(dueAt && new Date(dueAt).getTime() <= now.getTime());
}

export function subscriptionAccessPatch(subscription, now = new Date()) {
  const status = subscription.status;
  const periodEnd = subscriptionPeriodEndSeconds(subscription);
  const cancellationAt = scheduledCancellationAtSeconds(subscription);
  const patch = {
    stripeSubscriptionStatus: status,
    stripeCancelAtPeriodEnd: String(Boolean(cancellationAt)),
    stripeCurrentPeriodEnd: secondsToIso(periodEnd)
  };

  if (status === 'active' || status === 'trialing') {
    patch.accessStatus = 'active';
    patch.paymentFailureOpen = 'false';
    patch.paymentFailureStartedAt = '';
    patch.paymentReminderDueAt = '';
    patch.paymentSuspendDueAt = '';
    patch.paymentFailedEmailSentAt = '';
    patch.paymentReminderEmailSentAt = '';
    patch.paymentSuspendedEmailSentAt = '';
  }

  if (status === 'past_due') {
    patch.accessStatus = 'grace_period';
    Object.assign(patch, buildFailureWindow(now));
  }

  if (status === 'unpaid' || status === 'paused') {
    patch.accessStatus = 'suspended';
  }

  if (cancellationAt) {
    patch.cancellationPending = 'true';
    patch.cancelAccessAt = secondsToIso(cancellationAt);
  } else if (status !== 'canceled') {
    patch.cancellationPending = 'false';
    patch.cancelAccessAt = '';
  }

  if (status === 'canceled') {
    patch.accessStatus = 'suspended';
    patch.cancellationPending = 'false';
  }

  return patch;
}
