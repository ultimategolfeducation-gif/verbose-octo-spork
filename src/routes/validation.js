import express from 'express';
import {
  activateMachine,
  validateLicenseKey
} from '../clients/keygenClient.js';
import { asyncHandler } from '../errors.js';

export const validationRouter = express.Router();

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

    let validation = await validateLicenseKey({ licenseKey });
    let valid = Boolean(validation.meta?.valid);
    let license = validation.data;
    let suspended = Boolean(license?.attributes?.suspended);

    if (!valid || suspended) {
      return res.status(403).json({
        allowed: false,
        code: suspended ? 'LICENSE_SUSPENDED' : validation.meta?.code || 'LICENSE_INVALID',
        detail:
          suspended
            ? 'This ForceMap license is suspended.'
            : validation.meta?.detail || 'This ForceMap license is not valid.'
      });
    }

    if (activate && machineFingerprint && license?.id) {
      try {
        await activateMachine({
          licenseId: license.id,
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
      license = validation.data || license;
      suspended = Boolean(license?.attributes?.suspended);

      if (!valid || suspended) {
        return res.status(403).json({
          allowed: false,
          code: suspended ? 'LICENSE_SUSPENDED' : validation.meta?.code || 'LICENSE_INVALID',
          detail:
            suspended
              ? 'This ForceMap license is suspended.'
              : validation.meta?.detail || 'This ForceMap license is not valid for this computer.'
        });
      }
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
