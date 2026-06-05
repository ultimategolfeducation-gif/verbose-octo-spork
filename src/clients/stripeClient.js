import Stripe from 'stripe';
import { getConfig } from '../config.js';

let stripeClient;
let stripeClientForTests;

export function stripe() {
  if (stripeClientForTests) {
    return stripeClientForTests;
  }
  if (!stripeClient) {
    stripeClient = new Stripe(getConfig().stripeSecretKey);
  }
  return stripeClient;
}

export function setStripeClientForTests(client) {
  stripeClientForTests = client;
}

export async function retrieveSubscription(subscriptionId) {
  return stripe().subscriptions.retrieve(subscriptionId, {
    expand: ['customer', 'items.data.price.product', 'latest_invoice']
  });
}

export async function retrieveCustomer(customerId) {
  return stripe().customers.retrieve(customerId);
}

export async function createBillingPortalSession({ customerId, returnUrl }) {
  return stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  });
}
