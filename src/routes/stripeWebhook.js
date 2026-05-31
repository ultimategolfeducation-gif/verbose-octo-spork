import express from 'express';
import { stripe } from '../clients/stripeClient.js';
import { getConfig } from '../config.js';
import {
  applySubscriptionState,
  handlePaymentFailed,
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

      switch (event.type) {
        case 'checkout.session.completed':
          await provisionLicenseFromCheckout(event.data.object);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await applySubscriptionState(event.data.object, event.type);
          break;
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;
        default:
          break;
      }

      res.json({ received: true });
    } catch (error) {
      next(error);
    }
  }
);
