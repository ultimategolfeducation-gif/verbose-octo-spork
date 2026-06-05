import { sendAbuseAlertEmail } from './email.js';
import { hashValue, licenseHash } from './securityAudit.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STAFF_ALERT_COOLDOWN_MS = 30 * DAY_MS;

const licenseEvents = new Map();
const ipEvents = new Map();
const sentAlerts = new Map();

let nowFunc = () => Date.now();
let alertSender = sendAbuseAlertEmail;

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function maskedLicenseKey(value) {
  const key = textValue(value).toUpperCase();
  if (!key) {
    return '';
  }
  if (key.length <= 10) {
    return `${key.slice(0, 2)}...${key.slice(-2)}`;
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function machineHash(value) {
  return hashValue(textValue(value));
}

function prune(events, cutoff) {
  return events.filter((event) => event.at >= cutoff);
}

function addEvent(map, key, event, windowMs) {
  if (!key) {
    return [];
  }
  const cutoff = event.at - windowMs;
  const events = prune(map.get(key) || [], cutoff);
  events.push(event);
  map.set(key, events);
  return events;
}

function uniqueCount(events, field) {
  return new Set(events.map((event) => event[field]).filter(Boolean)).size;
}

function latestEvent(events) {
  return events[events.length - 1] || {};
}

function alertStillCoolingDown(key, cooldownMs, now) {
  const lastSentAt = sentAlerts.get(key);
  return lastSentAt && now - lastSentAt < cooldownMs;
}

async function sendAlert({ key, cooldownMs, title, reason, event, counts }) {
  const now = nowFunc();
  if (alertStillCoolingDown(key, cooldownMs, now)) {
    return false;
  }
  sentAlerts.set(key, now);

  const lines = [
    `Alert: ${title}`,
    '',
    `Reason: ${reason}`,
    `Time: ${new Date(event.at).toISOString()}`,
    `Licence: ${event.maskedLicense || 'not supplied'}`,
    `Licence hash: ${event.license || 'not supplied'}`,
    `Plan: ${event.planName || 'unknown'}`,
    `Registered to: ${event.registeredName || 'unknown'}`,
    `Email: ${event.registeredEmail || 'unknown'}`,
    `IP: ${event.ip || 'unknown'}`,
    `Machine: ${event.machine || 'not supplied'}`,
    `Event: ${event.type}`,
    `Code: ${event.code || 'n/a'}`
  ];

  if (counts) {
    lines.push('', 'Counts:');
    for (const [name, value] of Object.entries(counts)) {
      lines.push(`- ${name}: ${value}`);
    }
  }

  lines.push(
    '',
    'Recommended action:',
    'Review the licence in Keygen. If suspicious, contact the customer, reset activations, suspend the licence, or rotate the staff key.'
  );

  await alertSender({
    subject: `ForceMap licence alert: ${title}`,
    text: lines.join('\n')
  });
  return true;
}

async function evaluateLicenseRules(event, events) {
  const oneHour = prune(events, event.at - HOUR_MS);
  const oneDay = prune(events, event.at - DAY_MS);
  const latest = latestEvent(events);
  const alerts = [];

  if (event.type === 'activation_limit') {
    alerts.push(
      sendAlert({
        key: `activation-limit:${event.license}`,
        cooldownMs: HOUR_MS,
        title: 'activation limit reached',
        reason: 'A licence hit its machine activation limit.',
        event,
        counts: {
          machinesSeen24h: uniqueCount(oneDay, 'machine'),
          ipsSeen24h: uniqueCount(oneDay, 'ip')
        }
      })
    );
  }

  const machinesSeen24h = uniqueCount(oneDay, 'machine');
  if (machinesSeen24h >= 3) {
    alerts.push(
      sendAlert({
        key: `many-machines:${event.license}`,
        cooldownMs: DAY_MS,
        title: 'licence seen on multiple machines',
        reason: 'One licence has been used from 3 or more different machines in 24 hours.',
        event: latest,
        counts: {
          machinesSeen24h,
          ipsSeen24h: uniqueCount(oneDay, 'ip'),
          events24h: oneDay.length
        }
      })
    );
  }

  const failedValidations1h = oneHour.filter((item) => item.type === 'validation_failed').length;
  if (failedValidations1h >= 10) {
    alerts.push(
      sendAlert({
        key: `failed-validations:${event.license}`,
        cooldownMs: HOUR_MS,
        title: 'repeated failed licence checks',
        reason: 'One licence has had 10 or more failed validation attempts in 1 hour.',
        event: latest,
        counts: {
          failedValidations1h,
          ipsSeen1h: uniqueCount(oneHour, 'ip'),
          machinesSeen1h: uniqueCount(oneHour, 'machine')
        }
      })
    );
  }

  if (event.type === 'staff_license_used') {
    alerts.push(
      sendAlert({
        key: `staff-used:${event.license}:${event.machine || 'no-machine'}:${event.ip || 'no-ip'}`,
        cooldownMs: STAFF_ALERT_COOLDOWN_MS,
        title: 'staff licence used',
        reason: 'A staff licence was used from a device/network. Confirm this is expected.',
        event,
        counts: {
          machinesSeen24h,
          ipsSeen24h: uniqueCount(oneDay, 'ip')
        }
      })
    );
  }

  await Promise.all(alerts);
}

async function evaluateIpRules(event, events) {
  const oneHour = prune(events, event.at - HOUR_MS);
  const licencesSeen1h = uniqueCount(oneHour, 'license');
  if (licencesSeen1h < 5) {
    return;
  }

  await sendAlert({
    key: `ip-many-licenses:${event.ip}`,
    cooldownMs: HOUR_MS,
    title: 'one IP tried many licence keys',
    reason: 'One IP address has tried 5 or more different licence keys in 1 hour.',
    event: latestEvent(oneHour),
    counts: {
      licencesSeen1h,
      events1h: oneHour.length
    }
  });
}

export function recordAbuseEvent(type, fields = {}) {
  const key = textValue(fields.licenseKey);
  const event = {
    at: nowFunc(),
    type,
    license: fields.license || licenseHash(key),
    maskedLicense: fields.maskedLicense || maskedLicenseKey(key),
    ip: textValue(fields.ip),
    machine: fields.machine || machineHash(fields.machineFingerprint),
    code: textValue(fields.code),
    planName: textValue(fields.planName),
    registeredName: textValue(fields.registeredName),
    registeredEmail: textValue(fields.registeredEmail)
  };

  if (!event.license && !event.ip) {
    return Promise.resolve();
  }

  const promises = [];
  if (event.license) {
    const events = addEvent(licenseEvents, event.license, event, DAY_MS);
    promises.push(evaluateLicenseRules(event, events));
  }
  if (event.ip) {
    const events = addEvent(ipEvents, event.ip, event, HOUR_MS);
    promises.push(evaluateIpRules(event, events));
  }

  return Promise.all(promises).catch((error) => {
    console.error(
      '[security] abuse_alert_failed',
      JSON.stringify({ message: error?.message || 'Alert failed.' })
    );
  });
}

export function setAbuseAlertSenderForTests(sender) {
  alertSender = sender || sendAbuseAlertEmail;
}

export function setAbuseMonitorNowForTests(now) {
  nowFunc = typeof now === 'function' ? now : () => Date.now();
}

export function resetAbuseMonitorForTests() {
  licenseEvents.clear();
  ipEvents.clear();
  sentAlerts.clear();
  nowFunc = () => Date.now();
  alertSender = sendAbuseAlertEmail;
}
