import test from 'node:test';
import assert from 'node:assert/strict';

import { setStripeClientForTests } from '../src/clients/stripeClient.js';
import {
  applySubscriptionState,
  customerNameFromSession,
  handleChargeRefunded,
  handlePaymentActionRequired
} from '../src/licenseWorkflow.js';

test('customerNameFromSession prefers checkout customer details', () => {
  const name = customerNameFromSession(
    {
      customer_details: {
        name: 'Checkout Name'
      },
      metadata: {
        name: 'Metadata Name'
      }
    },
    {
      name: 'Stripe Customer Name'
    }
  );

  assert.equal(name, 'Checkout Name');
});

test('customerNameFromSession falls back to Stripe customer then metadata', () => {
  assert.equal(
    customerNameFromSession(
      {
        metadata: {
          name: 'Metadata Name'
        }
      },
      {
        name: 'Stripe Customer Name'
      }
    ),
    'Stripe Customer Name'
  );

  assert.equal(
    customerNameFromSession(
      {
        metadata: {
          name: 'Metadata Name'
        }
      },
      null
    ),
    'Metadata Name'
  );
});

function testLicense(metadata = {}) {
  return {
    id: 'lic_123',
    type: 'licenses',
    attributes: {
      suspended: false,
      key: 'FORCEMAP-TEST-KEY',
      metadata: {
        customerEmail: 'coach@example.com',
        stripeSubscriptionId: 'sub_123',
        accessStatus: 'active',
        paymentFailureOpen: 'false',
        ...metadata
      }
    }
  };
}

function keygenBody(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/vnd.api+json' }
  });
}

test('active scheduled cancellation does not reinstate an already active licence', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    KEYGEN_ACCOUNT_ID: process.env.KEYGEN_ACCOUNT_ID,
    KEYGEN_API_TOKEN: process.env.KEYGEN_API_TOKEN
  };
  const license = testLicense({ customerEmail: '' });
  const requests = [];

  process.env.KEYGEN_ACCOUNT_ID = 'keygen-account';
  process.env.KEYGEN_API_TOKEN = 'keygen-token';

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });

    if (String(url).includes('/licenses?')) {
      return keygenBody({ data: [license] });
    }
    if (String(url).endsWith('/licenses/lic_123')) {
      const body = JSON.parse(options.body);
      return keygenBody({
        data: {
          ...license,
          attributes: {
            ...license.attributes,
            metadata: body.data.attributes.metadata
          }
        }
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await applySubscriptionState(
      {
        id: 'sub_123',
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: 1787536034,
        items: {
          data: [{ current_period_end: 1787536034 }]
        }
      },
      'customer.subscription.updated',
      'evt_cancel'
    );

    assert.equal(result.found, true);
    assert.equal(result.license.attributes.metadata.cancellationPending, 'true');
    assert.equal(
      result.license.attributes.metadata.cancelAccessAt,
      '2026-08-24T01:47:14.000Z'
    );
    assert.equal(
      requests.some((request) => request.url.endsWith('/actions/reinstate')),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test('payment action required updates licence state without sending a billing email', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    KEYGEN_ACCOUNT_ID: process.env.KEYGEN_ACCOUNT_ID,
    KEYGEN_API_TOKEN: process.env.KEYGEN_API_TOKEN,
    APP_BILLING_EMAILS_ENABLED: process.env.APP_BILLING_EMAILS_ENABLED
  };
  const license = testLicense();
  const requests = [];

  process.env.KEYGEN_ACCOUNT_ID = 'keygen-account';
  process.env.KEYGEN_API_TOKEN = 'keygen-token';
  process.env.APP_BILLING_EMAILS_ENABLED = 'false';

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    assert.doesNotMatch(String(url), /api\.mailersend\.com/);

    if (String(url).includes('/licenses?')) {
      return keygenBody({ data: [license] });
    }
    if (String(url).endsWith('/licenses/lic_123/actions/reinstate')) {
      return new Response(null, { status: 204 });
    }
    if (String(url).endsWith('/licenses/lic_123')) {
      const body = JSON.parse(options.body);
      return keygenBody({
        data: {
          ...license,
          attributes: {
            ...license.attributes,
            metadata: body.data.attributes.metadata
          }
        }
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await handlePaymentActionRequired(
      { id: 'in_123', subscription: 'sub_123' },
      'evt_action_required'
    );

    assert.equal(result.found, true);
    assert.equal(result.license.attributes.metadata.accessStatus, 'grace_period');
    assert.equal(
      result.license.attributes.metadata.lastStripeEventType,
      'invoice.payment_action_required'
    );
    assert.equal(result.license.attributes.metadata.lastPaymentActionRequiredInvoiceId, 'in_123');
    assert.ok(result.license.attributes.metadata.paymentFailureStartedAt);
    assert.equal(requests.some((request) => /api\.mailersend\.com/.test(request.url)), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test('refunded charge records refund metadata without changing access or emailing customer', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    KEYGEN_ACCOUNT_ID: process.env.KEYGEN_ACCOUNT_ID,
    KEYGEN_API_TOKEN: process.env.KEYGEN_API_TOKEN
  };
  const license = testLicense({ accessStatus: 'active' });
  const requests = [];

  process.env.KEYGEN_ACCOUNT_ID = 'keygen-account';
  process.env.KEYGEN_API_TOKEN = 'keygen-token';

  setStripeClientForTests({
    invoices: {
      retrieve: async (invoiceId, options) => {
        assert.equal(invoiceId, 'in_123');
        assert.deepEqual(options, { expand: ['subscription'] });
        return { id: 'in_123', subscription: 'sub_123' };
      }
    }
  });

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    assert.doesNotMatch(String(url), /api\.mailersend\.com/);

    if (String(url).includes('/licenses?')) {
      return keygenBody({ data: [license] });
    }
    if (String(url).endsWith('/licenses/lic_123')) {
      const body = JSON.parse(options.body);
      return keygenBody({
        data: {
          ...license,
          attributes: {
            ...license.attributes,
            metadata: body.data.attributes.metadata
          }
        }
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await handleChargeRefunded(
      {
        id: 'ch_123',
        invoice: 'in_123',
        payment_intent: 'pi_123',
        amount_refunded: 4995,
        currency: 'usd'
      },
      'evt_refunded'
    );

    assert.equal(result.found, true);
    assert.equal(result.license.attributes.metadata.accessStatus, 'active');
    assert.equal(result.license.attributes.metadata.lastStripeEventType, 'charge.refunded');
    assert.equal(result.license.attributes.metadata.lastRefundedChargeId, 'ch_123');
    assert.equal(result.license.attributes.metadata.lastRefundedInvoiceId, 'in_123');
    assert.equal(result.license.attributes.metadata.lastRefundAmount, '4995');
    assert.equal(requests.some((request) => /api\.mailersend\.com/.test(request.url)), false);
  } finally {
    setStripeClientForTests(null);
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});
