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

    const validation = await validateLicenseKey({
      licenseKey,
      fingerprint: machineFingerprint
    });
    const valid = Boolean(validation.meta?.valid);
    const license = validation.data;
    const suspended = Boolean(license?.attributes?.suspended);

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
        if (status !== 409 && status !== 422) {
          throw error;
        }
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
