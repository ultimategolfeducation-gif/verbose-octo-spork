import Stripe from 'stripe';
import { getConfig } from '../config.js';

let stripeClient;

export function stripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(getConfig().stripeSecretKey);
  }
  return stripeClient;
}

export async function retrieveSubscription(subscriptionId) {
  return stripe().subscriptions.retrieve(subscriptionId, {
    expand: ['customer', 'items.data.price.product', 'latest_invoice']
  });
}

export async function retrieveCustomer(customerId) {
  return stripe().customers.retrieve(customerId);
}
