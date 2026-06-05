import express from 'express';
import {
  activateMachine,
  listMachinesForLicense,
  retrieveLicense,
  validateLicenseKey
} from '../clients/keygenClient.js';
import {
  createBillingPortalSession,
  retrieveCustomer
} from '../clients/stripeClient.js';
import { getConfig } from '../config.js';
import { asyncHandler } from '../errors.js';
import { recordAbuseEvent } from '../abuseMonitor.js';
import {
  billingPortalSchema,
  licenseValidationSchema,
  validatePayload
} from '../requestValidation.js';
import { auditEvent, clientIp, licenseHash } from '../securityAudit.js';

export const validationRouter = express.Router();

function isFirstActivationFailure(validation) {
  const code = String(validation?.meta?.code || '').toUpperCase();
  const detail = String(validation?.meta?.detail || '').toLowerCase();
  return (
    code === 'NO_MACHINE' ||
    code === 'NO_MACHINES' ||
    code === 'FINGERPRINT_SCOPE_MISMATCH' ||
    detail.includes('fingerprint is not activated') ||
    detail.includes('has no associated machines') ||
    detail.includes('not activated')
  );
}

function validationFailurePayload(validation, license, fallbackDetail) {
  const suspended = Boolean(license?.attributes?.suspended);
  return {
    allowed: false,
    code: suspended ? 'LICENSE_SUSPENDED' : validation.meta?.code || 'LICENSE_INVALID',
    detail:
      suspended
        ? 'This ForceMap license is suspended.'
        : validation.meta?.detail || fallbackDetail
  };
}

function hasExpectedPolicy(license, { productScopedValidation = false } = {}) {
  if (productScopedValidation) {
    return true;
  }

  const policyId = license?.relationships?.policy?.data?.id;
  const metadata = metadataFor(license);
  const policyName = textValue(
    license?.relationships?.policy?.data?.attributes?.name,
    license?.attributes?.policyName
  ).toLowerCase();
  const productType = textValue(metadata.productType).toLowerCase();

  return (
    !policyId ||
    policyId === getConfig().keygenPolicyId ||
    policyName.includes('staff') ||
    productType.includes('staff')
  );
}

function metadataFor(license) {
  return license?.attributes?.metadata || {};
}

function textValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function nameValue(...values) {
  const value = textValue(...values);
  return value.includes('@') ? '' : value;
}

function licenseNameValue(license) {
  const value = nameValue(license?.attributes?.name);
  return value.replace(/\s*-?\s*staff\s*(licen[cs]e)?\s*$/i, '').trim();
}

async function stripeCustomerProfile(metadata) {
  const stripeCustomerId = textValue(metadata.stripeCustomerId);
  if (!stripeCustomerId || (textValue(metadata.customerName) && textValue(metadata.customerEmail))) {
    return { name: '', email: '' };
  }

  try {
    const customer = await retrieveCustomer(stripeCustomerId);
    return {
      name: nameValue(customer?.name),
      email: textValue(customer?.email)
    };
  } catch (_error) {
    return { name: '', email: '' };
  }
}

function licenseLooksStaff(productType, license) {
  const raw = textValue(productType);
  const lower = raw.toLowerCase();
  const policyName = textValue(
    license?.relationships?.policy?.data?.attributes?.name,
    license?.attributes?.policyName
  ).toLowerCase();
  const licenseName = textValue(license?.attributes?.name).toLowerCase();
  return (
    lower === 'staff' ||
    lower.includes('staff') ||
    policyName.includes('staff') ||
    licenseName.includes('staff')
  );
}

function normalisePlanName(productType, license) {
  const raw = textValue(productType);
  const lower = raw.toLowerCase();

  if (licenseLooksStaff(raw, license)) {
    return 'Pro Staff';
  }
  if (lower === 'monthly' || lower.includes('month')) {
    return 'Pro Monthly';
  }
  if (lower === 'annual' || lower === 'yearly' || lower.includes('year')) {
    return 'Pro Annual';
  }
  return raw ? `Pro ${raw}` : 'Pro';
}

function renewalFields(metadata, license) {
  const productType = textValue(metadata.productType).toLowerCase();
  const cancellationPending = String(metadata.cancellationPending || '').toLowerCase() === 'true';
  const accessStatus = textValue(metadata.accessStatus).toLowerCase();
  const currentPeriodEnd = textValue(metadata.stripeCurrentPeriodEnd);
  const cancelAccessAt = textValue(metadata.cancelAccessAt);

  if (licenseLooksStaff(productType, license)) {
    return { renewsAt: '', expiresAt: '' };
  }
  if (cancellationPending || accessStatus === 'canceled' || accessStatus === 'cancelled') {
    return {
      renewsAt: '',
      expiresAt: cancelAccessAt || currentPeriodEnd
    };
  }
  return {
    renewsAt: currentPeriodEnd,
    expiresAt: ''
  };
}

function deviceLimitFor(metadata, license) {
  const explicit = textValue(
    metadata.deviceLimit,
    metadata.machineLimit,
    metadata.activationLimit
  );
  if (explicit) {
    return explicit;
  }
  if (licenseLooksStaff(metadata.productType, license)) {
    return 'Unlimited';
  }
  const maxMachines = license?.attributes?.maxMachines;
  if (typeof maxMachines === 'number') {
    return maxMachines === 0 ? 'Unlimited' : String(maxMachines);
  }
  return '';
}

async function licenseProfilePayload(license) {
  const fullLicense = license?.id ? (await retrieveLicense(license.id)).data : license;
  const metadata = metadataFor(fullLicense);
  const { renewsAt, expiresAt } = renewalFields(metadata, fullLicense);
  const machines = fullLicense?.id ? await listMachinesForLicense(fullLicense.id) : [];
  const stripeCustomer = await stripeCustomerProfile(metadata);

  return {
    productName: 'ForceMap',
    registeredName: nameValue(metadata.customerName, stripeCustomer.name, licenseNameValue(fullLicense)),
    registeredEmail: textValue(metadata.customerEmail, stripeCustomer.email),
    planName: normalisePlanName(metadata.productType, fullLicense),
    renewsAt,
    expiresAt,
    deviceLimit: deviceLimitFor(metadata, fullLicense),
    deviceCount: machines.length ? String(machines.length) : '',
    billingUrl: ''
  };
}

async function validLicenseForBilling({ licenseKey, machineFingerprint }) {
  const validation = await validateLicenseKey({
    licenseKey,
    fingerprint: machineFingerprint
  });
  const valid = Boolean(validation.meta?.valid);
  const license = validation.data;
  const suspended = Boolean(license?.attributes?.suspended);

  if (!valid || suspended) {
    return {
      allowed: false,
      license,
      payload: validationFailurePayload(
        validation,
        license,
        'This ForceMap license is not valid for this computer.'
      )
    };
  }

  return {
    allowed: true,
    license: license?.id ? (await retrieveLicense(license.id)).data : license
  };
}

async function resolveActivationLicense(validation, licenseKey) {
  if (validation?.data?.id) {
    return validation.data;
  }
  try {
    return (await retrieveLicense(licenseKey)).data;
  } catch (_error) {
    return null;
  }
}

function abuseFields(req, { licenseKey, machineFingerprint, code, profile = {} }) {
  return {
    ip: clientIp(req),
    licenseKey,
    machineFingerprint,
    code,
    planName: profile.planName,
    registeredName: profile.registeredName,
    registeredEmail: profile.registeredEmail
  };
}

function profileSummaryFromLicense(license) {
  const metadata = metadataFor(license);
  return {
    planName: normalisePlanName(metadata.productType, license),
    registeredName: nameValue(metadata.customerName, licenseNameValue(license)),
    registeredEmail: textValue(metadata.customerEmail)
  };
}

validationRouter.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const {
      licenseKey,
      machineFingerprint,
      machineName,
      platform,
      activate
    } = validatePayload(req.body || {}, licenseValidationSchema);
    let activatedMachine = false;

    void recordAbuseEvent(
      'validation_attempt',
      abuseFields(req, { licenseKey, machineFingerprint })
    );

    let validation = await validateLicenseKey({
      licenseKey,
      fingerprint: machineFingerprint
    });
    let valid = Boolean(validation.meta?.valid);
    let license = validation.data;
    let suspended = Boolean(license?.attributes?.suspended);

    if (!valid && activate && machineFingerprint && !suspended) {
      const activationLicense = await resolveActivationLicense(validation, licenseKey);
      const shouldActivate =
        activationLicense?.id &&
        !activationLicense?.attributes?.suspended &&
        hasExpectedPolicy(activationLicense, {
          productScopedValidation: Boolean(validation?.data?.id)
        }) &&
        (isFirstActivationFailure(validation) || !validation.meta?.code);

      if (shouldActivate) {
        auditEvent(req, 'license_activation_attempt', {
          license: licenseHash(licenseKey),
          licenseId: activationLicense.id
        });
        void recordAbuseEvent(
          'activation_attempt',
          abuseFields(req, { licenseKey, machineFingerprint, code: validation.meta?.code })
        );
        try {
          await activateMachine({
            licenseId: activationLicense.id,
            licenseKey,
            fingerprint: machineFingerprint,
            name: machineName || 'ForceMap Windows device',
            platform: platform || 'Windows'
          });
          activatedMachine = true;
        } catch (error) {
          const status = error.statusCode;
          if (status === 409) {
            // Already activated for this machine. Confirm below with fingerprint validation.
          } else if (status === 422) {
            auditEvent(req, 'license_activation_limit', {
              license: licenseHash(licenseKey),
              licenseId: activationLicense.id
            });
            void recordAbuseEvent(
              'activation_limit',
              abuseFields(req, { licenseKey, machineFingerprint, code: 'LICENSE_ACTIVATION_LIMIT' })
            );
            return res.status(403).json({
              allowed: false,
              code: 'LICENSE_ACTIVATION_LIMIT',
              detail:
                error.message ||
                'This ForceMap license has reached its activation limit.'
            });
          } else {
            throw error;
          }
        }

        validation = await validateLicenseKey({
          licenseKey,
          fingerprint: machineFingerprint
        });
        valid = Boolean(validation.meta?.valid);
        license = validation.data || activationLicense;
        suspended = Boolean(license?.attributes?.suspended);
      }
    }

    if (!valid || suspended) {
      auditEvent(req, 'license_validation_failed', {
        license: licenseHash(licenseKey),
        code: suspended ? 'LICENSE_SUSPENDED' : validation.meta?.code || 'LICENSE_INVALID'
      });
      void recordAbuseEvent(
        'validation_failed',
        abuseFields(req, {
          licenseKey,
          machineFingerprint,
          code: suspended ? 'LICENSE_SUSPENDED' : validation.meta?.code || 'LICENSE_INVALID'
        })
      );
      return res.status(403).json(
        validationFailurePayload(
          validation,
          license,
          'This ForceMap license is not valid for this computer.'
        )
      );
    }

    const profile = await licenseProfilePayload(license);
    if (activatedMachine) {
      void recordAbuseEvent(
        'successful_activation',
        abuseFields(req, { licenseKey, machineFingerprint, profile })
      );
    }
    if (String(profile.planName || '').toLowerCase().includes('staff')) {
      void recordAbuseEvent(
        'staff_license_used',
        abuseFields(req, { licenseKey, machineFingerprint, profile })
      );
    }

    res.json({
      allowed: true,
      code: validation.meta?.code || 'VALID',
      detail: validation.meta?.detail || 'License is valid.',
      licenseId: license?.id,
      status: license?.attributes?.status,
      suspended,
      ...profile
    });
  })
);

validationRouter.post(
  '/billing-portal',
  asyncHandler(async (req, res) => {
    const { licenseKey, machineFingerprint } = validatePayload(
      req.body || {},
      billingPortalSchema
    );

    const billingLicense = await validLicenseForBilling({
      licenseKey,
      machineFingerprint
    });

    if (!billingLicense.allowed) {
      auditEvent(req, 'billing_portal_validation_failed', {
        license: licenseHash(licenseKey),
        code: billingLicense.payload.code
      });
      void recordAbuseEvent(
        'validation_failed',
        abuseFields(req, {
          licenseKey,
          machineFingerprint,
          code: billingLicense.payload.code
        })
      );
      return res.status(403).json({
        ok: false,
        ...billingLicense.payload
      });
    }

    const metadata = metadataFor(billingLicense.license);
    const stripeCustomerId = textValue(metadata.stripeCustomerId);
    const productType = textValue(metadata.productType).toLowerCase();

    if (!stripeCustomerId || productType.includes('staff')) {
      auditEvent(req, 'billing_portal_unavailable', {
        license: licenseHash(licenseKey),
        productType: productType || 'unknown'
      });
      return res.status(403).json({
        ok: false,
        code: 'BILLING_NOT_AVAILABLE',
        detail: 'Billing management is not available for this ForceMap licence.'
      });
    }

    const portalSession = await createBillingPortalSession({
      customerId: stripeCustomerId,
      returnUrl: getConfig().stripeBillingReturnUrl
    });

    auditEvent(req, 'billing_portal_created', {
      license: licenseHash(licenseKey)
    });
    void recordAbuseEvent(
      'billing_portal_opened',
      abuseFields(req, {
        licenseKey,
        machineFingerprint,
        profile: profileSummaryFromLicense(billingLicense.license)
      })
    );

    res.json({
      ok: true,
      billingUrl: portalSession.url
    });
  })
);
