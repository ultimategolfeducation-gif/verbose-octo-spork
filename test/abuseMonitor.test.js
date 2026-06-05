import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordAbuseEvent,
  resetAbuseMonitorForTests,
  setAbuseAlertSenderForTests,
  setAbuseMonitorNowForTests
} from '../src/abuseMonitor.js';

const BASE_TIME = Date.parse('2026-06-05T06:00:00.000Z');

function setupAlerts() {
  const alerts = [];
  resetAbuseMonitorForTests();
  setAbuseMonitorNowForTests(() => BASE_TIME);
  setAbuseAlertSenderForTests(async (alert) => {
    alerts.push(alert);
    return {};
  });
  return alerts;
}

test('activation limit sends a masked abuse alert', async () => {
  const alerts = setupAlerts();

  await recordAbuseEvent('activation_limit', {
    ip: '203.0.113.10',
    licenseKey: 'FORCEMAP-CUSTOMER-SECRET',
    machineFingerprint: 'machine-one',
    code: 'LICENSE_ACTIVATION_LIMIT',
    planName: 'Pro Monthly',
    registeredName: 'Mark Ashton Golf'
  });

  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /activation limit reached/);
  assert.match(alerts[0].text, /FORC\.\.\.CRET/);
  assert.doesNotMatch(alerts[0].text, /FORCEMAP-CUSTOMER-SECRET/);
  assert.doesNotMatch(alerts[0].text, /machine-one/);
});

test('one licence on three machines in 24 hours sends one alert', async () => {
  const alerts = setupAlerts();

  for (const machineFingerprint of ['machine-one', 'machine-two', 'machine-three']) {
    await recordAbuseEvent('validation_attempt', {
      ip: '203.0.113.10',
      licenseKey: 'FORCEMAP-CUSTOMER-SECRET',
      machineFingerprint
    });
  }
  await recordAbuseEvent('validation_attempt', {
    ip: '203.0.113.11',
    licenseKey: 'FORCEMAP-CUSTOMER-SECRET',
    machineFingerprint: 'machine-four'
  });

  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /multiple machines/);
  assert.match(alerts[0].text, /machinesSeen24h: 3/);
});

test('ten failed validations in one hour sends an alert', async () => {
  const alerts = setupAlerts();

  for (let index = 0; index < 10; index += 1) {
    await recordAbuseEvent('validation_failed', {
      ip: `203.0.113.${index + 1}`,
      licenseKey: 'FORCEMAP-CUSTOMER-SECRET',
      machineFingerprint: 'machine-one',
      code: 'LICENSE_INVALID'
    });
  }

  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /failed licence checks/);
  assert.match(alerts[0].text, /failedValidations1h: 10/);
});

test('one IP trying five licence keys sends an alert', async () => {
  const alerts = setupAlerts();

  for (let index = 0; index < 5; index += 1) {
    await recordAbuseEvent('validation_attempt', {
      ip: '203.0.113.55',
      licenseKey: `FORCEMAP-CUSTOMER-${index}`,
      machineFingerprint: 'machine-one'
    });
  }

  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /many licence keys/);
  assert.match(alerts[0].text, /licencesSeen1h: 5/);
});

test('staff licence use alerts once per device and network cooldown', async () => {
  const alerts = setupAlerts();

  await recordAbuseEvent('staff_license_used', {
    ip: '203.0.113.10',
    licenseKey: 'FORCEMAP-STAFF-SECRET',
    machineFingerprint: 'staff-machine-one',
    planName: 'Pro Staff',
    registeredName: 'Mark Ashton'
  });
  await recordAbuseEvent('staff_license_used', {
    ip: '203.0.113.10',
    licenseKey: 'FORCEMAP-STAFF-SECRET',
    machineFingerprint: 'staff-machine-one',
    planName: 'Pro Staff',
    registeredName: 'Mark Ashton'
  });

  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /staff licence used/);
  assert.doesNotMatch(alerts[0].text, /FORCEMAP-STAFF-SECRET/);
  assert.doesNotMatch(alerts[0].text, /staff-machine-one/);
});
