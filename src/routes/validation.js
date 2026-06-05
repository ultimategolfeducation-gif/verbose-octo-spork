import express from 'express';
import {
  activateMachine,
  listMachinesForLicense,
  retrieveLicense,
  validateLicenseKey
} from '../clients/keygenClient.js';
import { getConfig } from '../config.js';
import { asyncHandler } from '../errors.js';

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

function hasExpectedPolicy(license) {
  const policyId = license?.relationships?.policy?.data?.id;
  return !policyId || policyId === getConfig().keygenPolicyId;
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

function normalisePlanName(productType, license) {
  const raw = textValue(productType);
  const lower = raw.toLowerCase();
  const policyName = textValue(
    license?.relationships?.policy?.data?.attributes?.name,
    license?.attributes?.policyName
  ).toLowerCase();
  const licenseName = textValue(license?.attributes?.name).toLowerCase();
  const looksStaff =
    lower === 'staff' ||
    lower.includes('staff') ||
    policyName.includes('staff') ||
    licenseName.includes('staff');

  if (looksStaff) {
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

function renewalFields(metadata) {
  const productType = textValue(metadata.productType).toLowerCase();
  const cancellationPending = String(metadata.cancellationPending || '').toLowerCase() === 'true';
  const accessStatus = textValue(metadata.accessStatus).toLowerCase();
  const currentPeriodEnd = textValue(metadata.stripeCurrentPeriodEnd);
  const cancelAccessAt = textValue(metadata.cancelAccessAt);

  if (productType.includes('staff')) {
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
  if (textValue(metadata.productType).toLowerCase().includes('staff')) {
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
  const { renewsAt, expiresAt } = renewalFields(metadata);
  const machines = fullLicense?.id ? await listMachinesForLicense(fullLicense.id) : [];

  return {
    productName: 'ForceMap',
    registeredName: textValue(metadata.customerName),
    registeredEmail: textValue(metadata.customerEmail),
    planName: normalisePlanName(metadata.productType, fullLicense),
    renewsAt,
    expiresAt,
    deviceLimit: deviceLimitFor(metadata, fullLicense),
    deviceCount: machines.length ? String(machines.length) : '',
    billingUrl: ''
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

validationRouter.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const {
      licenseKey,
      machineFingerprint,
      machineName = 'ForceMap Windows device',
      platform = 'Windows',
      activate = true
    } = req.body || {};

    if (!licenseKey) {
      return res.status(400).json({
        allowed: false,
        code: 'LICENSE_KEY_REQUIRED',
        detail: 'A license key is required.'
      });
    }

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
        hasExpectedPolicy(activationLicense) &&
        (isFirstActivationFailure(validation) || !validation.meta?.code);

      if (shouldActivate) {
        try {
          await activateMachine({
            licenseId: activationLicense.id,
            licenseKey,
            fingerprint: machineFingerprint,
            name: machineName,
            platform
          });
        } catch (error) {
          const status = error.statusCode;
          if (status === 409) {
            // Already activated for this machine. Confirm below with fingerprint validation.
          } else if (status === 422) {
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
      return res.status(403).json(
        validationFailurePayload(
          validation,
          license,
          'This ForceMap license is not valid for this computer.'
        )
      );
    }

    const profile = await licenseProfilePayload(license);

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
