import test from 'node:test';
import assert from 'node:assert/strict';

import { customerNameFromSession } from '../src/licenseWorkflow.js';

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
