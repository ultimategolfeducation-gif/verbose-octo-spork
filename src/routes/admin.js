import express from 'express';
import { requireAdmin, requireTaskToken } from '../auth.js';
import {
  createLicense,
  findLicenseByAnyIdentifier,
  reinstateLicense,
  resetMachinesForLicense,
  suspendLicense,
  updateLicenseMetadata
} from '../clients/keygenClient.js';
import { retrieveSubscription } from '../clients/stripeClient.js';
import { sendWelcomeEmail } from '../email.js';
import { processDueLicenseActions } from '../licenseWorkflow.js';
import { getProductTypeFromSubscription, secondsToIso } from '../subscriptionPolicy.js';
import { asyncHandler } from '../errors.js';

export const adminRouter = express.Router();

adminRouter.post(
  '/tasks/process-due-actions',
  requireTaskToken,
  asyncHandler(async (_req, res) => {
    res.json(await processDueLicenseActions());
  })
);

adminRouter.use(requireAdmin);

async function findLicenseFromBody(body) {
  return findLicenseByAnyIdentifier({
    licenseId: body.licenseId,
    subscriptionId: body.subscriptionId,
    email: body.email
  });
}

adminRouter.post(
  '/resend-welcome',
  asyncHandler(async (req, res) => {
    const license = await findLicenseFromBody(req.body || {});
    await sendWelcomeEmail({
      email: license.attributes.metadata.customerEmail,
      licenseKey: license.attributes.key
    });
    await updateLicenseMetadata(license, {
      welcomeEmailResentAt: new Date().toISOString()
    });
    res.json({ ok: true, licenseId: license.id });
  })
);

adminRouter.post(
  '/reissue-license',
  asyncHandler(async (req, res) => {
    const oldLicense = await findLicenseFromBody(req.body || {});
    const metadata = oldLicense.attributes.metadata || {};
    const email = metadata.customerEmail;
    const subscription = metadata.stripeSubscriptionId
      ? await retrieveSubscription(metadata.stripeSubscriptionId)
      : null;

    const newLicense = await createLicense({
      email,
      metadata: {
        ...metadata,
        keygenLicenseId: '',
        reissuedFromLicenseId: oldLicense.id,
        productType: subscription ? getProductTypeFromSubscription(subscription) : metadata.productType,
        stripeSubscriptionStatus: subscription?.status || metadata.stripeSubscriptionStatus,
        stripeCurrentPeriodEnd:
          secondsToIso(subscription?.current_period_end) ||
          metadata.stripeCurrentPeriodEnd ||
          '',
        createdBy: 'admin.reissue-license',
        createdAt: new Date().toISOString()
      }
    });

    await updateLicenseMetadata(newLicense.data, {
      keygenLicenseId: newLicense.data.id
    });
    await suspendLicense(oldLicense.id);
    await updateLicenseMetadata(oldLicense, {
      accessStatus: 'superseded',
      supersededByLicenseId: newLicense.data.id
    });
    await sendWelcomeEmail({ email, licenseKey: newLicense.data.attributes.key });

    res.json({
      ok: true,
      oldLicenseId: oldLicense.id,
      newLicenseId: newLicense.data.id
    });
  })
);

adminRouter.post(
  '/suspend-license',
  asyncHandler(async (req, res) => {
    const license = await findLicenseFromBody(req.body || {});
    await suspendLicense(license.id);
    await updateLicenseMetadata(license, {
      accessStatus: 'suspended',
      suspendedByAdminAt: new Date().toISOString()
    });
    res.json({ ok: true, licenseId: license.id });
  })
);

adminRouter.post(
  '/reactivate-license',
  asyncHandler(async (req, res) => {
    const license = await findLicenseFromBody(req.body || {});
    await reinstateLicense(license.id);
    await updateLicenseMetadata(license, {
      accessStatus: 'active',
      reactivatedByAdminAt: new Date().toISOString()
    });
    res.json({ ok: true, licenseId: license.id });
  })
);

adminRouter.post(
  '/reset-activations',
  asyncHandler(async (req, res) => {
    const license = await findLicenseFromBody(req.body || {});
    const result = await resetMachinesForLicense(license.id);
    await updateLicenseMetadata(license, {
      activationsResetAt: new Date().toISOString()
    });
    res.json({ ok: true, licenseId: license.id, ...result });
  })
);

adminRouter.get(
  '/customer-status',
  asyncHandler(async (req, res) => {
    const license = await findLicenseByAnyIdentifier({
      licenseId: req.query.licenseId,
      subscriptionId: req.query.subscriptionId,
      email: req.query.email
    });
    const subscriptionId = license.attributes.metadata?.stripeSubscriptionId;
    const subscription = subscriptionId ? await retrieveSubscription(subscriptionId) : null;

    res.json({
      license: {
        id: license.id,
        key: license.attributes.key,
        status: license.attributes.status,
        suspended: license.attributes.suspended,
        metadata: license.attributes.metadata
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodEnd: secondsToIso(subscription.current_period_end)
          }
        : null
    });
  })
);
