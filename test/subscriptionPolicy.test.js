import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRACE_PERIOD_MS,
  REMINDER_DELAY_MS,
  buildFailureWindow,
  subscriptionAccessPatch
} from '../src/subscriptionPolicy.js';

test('active subscriptions keep access active and clear failure metadata', () => {
  const patch = subscriptionAccessPatch({
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: 1780000000
  });

  assert.equal(patch.accessStatus, 'active');
  assert.equal(patch.paymentFailureOpen, 'false');
  assert.equal(patch.cancellationPending, 'false');
});

test('past_due subscriptions enter a 48-hour grace period', () => {
  const now = new Date('2026-05-31T00:00:00.000Z');
  const patch = subscriptionAccessPatch(
    {
      status: 'past_due',
      cancel_at_period_end: false,
      current_period_end: 1780000000
    },
    now
  );

  assert.equal(patch.accessStatus, 'grace_period');
  assert.equal(patch.paymentFailureOpen, 'true');
  assert.equal(
    new Date(patch.paymentReminderDueAt).getTime(),
    now.getTime() + REMINDER_DELAY_MS
  );
  assert.equal(
    new Date(patch.paymentSuspendDueAt).getTime(),
    now.getTime() + GRACE_PERIOD_MS
  );
});

test('unpaid subscriptions suspend access', () => {
  const patch = subscriptionAccessPatch({
    status: 'unpaid',
    cancel_at_period_end: false,
    current_period_end: 1780000000
  });

  assert.equal(patch.accessStatus, 'suspended');
});

test('scheduled cancellations remain active until period end', () => {
  const patch = subscriptionAccessPatch({
    status: 'active',
    cancel_at_period_end: true,
    current_period_end: 1780000000
  });

  assert.equal(patch.accessStatus, 'active');
  assert.equal(patch.cancellationPending, 'true');
  assert.equal(patch.cancelAccessAt, '2026-05-28T20:26:40.000Z');
});

test('failure window uses 24-hour reminder and 48-hour suspension', () => {
  const now = new Date('2026-05-31T10:00:00.000Z');
  const window = buildFailureWindow(now);

  assert.equal(window.paymentFailureOpen, 'true');
  assert.equal(
    new Date(window.paymentReminderDueAt).getTime(),
    now.getTime() + 24 * 60 * 60 * 1000
  );
  assert.equal(
    new Date(window.paymentSuspendDueAt).getTime(),
    now.getTime() + 48 * 60 * 60 * 1000
  );
});
