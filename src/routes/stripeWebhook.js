import express from 'express';
import { stripe } from '../clients/stripeClient.js';
import { getConfig } from '../config.js';
import { auditEvent, errorSummary } from '../securityAudit.js';
import {
  applySubscriptionState,
  handleChargeRefunded,
  handlePaymentActionRequired,
  handlePaymentFailed,
  handlePaymentSucceeded,
  provisionLicenseFromCheckout
} from '../licenseWorkflow.js';

export const stripeWebhookRouter = express.Router();

stripeWebhookRouter.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req, res, next) => {
    try {
      const signature = req.get('stripe-signature');
      const event = stripe().webhooks.constructEvent(
        req.body,
        signature,
        getConfig().stripeWebhookSecret
      );
      auditEvent(req, 'stripe_webhook_received', { type: event.type });

      switch (event.type) {
        case 'checkout.session.completed':
          await provisionLicenseFromCheckout(event.data.object);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed':
        case 'customer.subscription.pending_update_applied':
        case 'customer.subscription.pending_update_expired':
          await applySubscriptionState(event.data.object, event.type, event.id);
          break;
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object, event.id);
          break;
        case 'invoice.payment_action_required':
          await handlePaymentActionRequired(event.data.object, event.id);
          break;
        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object, event.id);
          break;
        case 'charge.refunded':
          await handleChargeRefunded(event.data.object, event.id);
          break;
        default:
          break;
      }

      res.json({ received: true });
    } catch (error) {
      auditEvent(req, 'stripe_webhook_failed', errorSummary(error));
      next(error);
    }
  }
);
