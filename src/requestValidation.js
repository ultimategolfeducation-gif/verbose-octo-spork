import { HttpError } from './errors.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnexpectedFields(payload, schema) {
  const allowed = new Set(Object.keys(schema));
  const unexpected = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new HttpError(400, `Unexpected field: ${unexpected[0]}`);
  }
}

function cleanString(value, field, rules) {
  if (value === undefined || value === null || value === '') {
    if (rules.required) {
      throw new HttpError(400, `${field} is required.`);
    }
    return '';
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be text.`);
  }
  const cleaned = value.trim();
  if (rules.required && !cleaned) {
    throw new HttpError(400, `${field} is required.`);
  }
  if (rules.minLength && cleaned.length < rules.minLength) {
    throw new HttpError(400, `${field} is too short.`);
  }
  if (rules.maxLength && cleaned.length > rules.maxLength) {
    throw new HttpError(400, `${field} is too long.`);
  }
  if (rules.pattern && cleaned && !rules.pattern.test(cleaned)) {
    throw new HttpError(400, `${field} has an invalid format.`);
  }
  if (rules.allowedValues && cleaned && !rules.allowedValues.includes(cleaned)) {
    throw new HttpError(400, `${field} is not supported.`);
  }
  return cleaned;
}

function cleanBoolean(value, field, rules) {
  if (value === undefined || value === null) {
    if (rules.required) {
      throw new HttpError(400, `${field} is required.`);
    }
    return rules.defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new HttpError(400, `${field} must be true or false.`);
  }
  return value;
}

export function validatePayload(payload, schema) {
  if (!isPlainObject(payload)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  rejectUnexpectedFields(payload, schema);

  const cleaned = {};
  for (const [field, rules] of Object.entries(schema)) {
    if (rules.type === 'string') {
      cleaned[field] = cleanString(payload[field], field, rules);
    } else if (rules.type === 'boolean') {
      cleaned[field] = cleanBoolean(payload[field], field, rules);
    }
  }
  return cleaned;
}

export function validateQuery(query, schema) {
  return validatePayload(Object.fromEntries(Object.entries(query || {})), schema);
}

export const licenseValidationSchema = {
  licenseKey: { type: 'string', required: true, minLength: 6, maxLength: 128 },
  machineFingerprint: { type: 'string', required: false, minLength: 8, maxLength: 128 },
  machineName: { type: 'string', required: false, maxLength: 120 },
  platform: {
    type: 'string',
    required: false,
    maxLength: 40,
    allowedValues: ['Windows', 'macOS', 'Linux']
  },
  activate: { type: 'boolean', required: false, defaultValue: true }
};

export const billingPortalSchema = {
  licenseKey: { type: 'string', required: true, minLength: 6, maxLength: 128 },
  machineFingerprint: { type: 'string', required: false, minLength: 8, maxLength: 128 },
  machineName: { type: 'string', required: false, maxLength: 120 },
  platform: {
    type: 'string',
    required: false,
    maxLength: 40,
    allowedValues: ['Windows', 'macOS', 'Linux']
  }
};

export const customerIdentifierSchema = {
  licenseId: { type: 'string', required: false, maxLength: 128 },
  subscriptionId: { type: 'string', required: false, maxLength: 128 },
  email: { type: 'string', required: false, maxLength: 254, pattern: EMAIL_PATTERN }
};
