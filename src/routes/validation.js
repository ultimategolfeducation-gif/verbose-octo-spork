import express from 'express';
import {
  activateMachine,
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

    res.json({
      allowed: true,
      code: validation.meta?.code || 'VALID',
      detail: validation.meta?.detail || 'License is valid.',
      licenseId: license?.id,
      status: license?.attributes?.status,
      suspended
    });
  })
);
