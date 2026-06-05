import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createApp } from '../src/app.js';

const ACTIVE_LICENSE = {
  id: 'lic_123',
  attributes: {
    status: 'ACTIVE',
    suspended: false
  },
  relationships: {
    policy: {
      data: {
        id: 'policy_123',
        type: 'policies'
      }
    }
  }
};

function postJson(server, path, payload) {
  const body = JSON.stringify(payload);
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : {}
          });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function withValidationServer(fetchHandler, callback) {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    KEYGEN_ACCOUNT_ID: process.env.KEYGEN_ACCOUNT_ID,
    KEYGEN_PRODUCT_ID: process.env.KEYGEN_PRODUCT_ID,
    KEYGEN_POLICY_ID: process.env.KEYGEN_POLICY_ID,
    KEYGEN_API_TOKEN: process.env.KEYGEN_API_TOKEN
  };
  const requests = [];

  process.env.KEYGEN_ACCOUNT_ID = 'account_123';
  process.env.KEYGEN_PRODUCT_ID = 'product_123';
  process.env.KEYGEN_POLICY_ID = 'policy_123';
  process.env.KEYGEN_API_TOKEN = 'keygen-token';

  globalThis.fetch = async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    requests.push({ url, options, payload });
    return fetchHandler(url, options, payload, requests);
  };

  const server = createApp().listen(0);

  try {
    await callback(server, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function validationResponse({ valid, code, detail, data = ACTIVE_LICENSE }) {
  return new Response(
    JSON.stringify({
      meta: { valid, code, detail },
      data
    }),
    { status: 200 }
  );
}

function machineResponse() {
  return new Response(
    JSON.stringify({
      data: {
        id: 'machine_123',
        type: 'machines'
      }
    }),
    { status: 201 }
  );
}

test('first-time licence activation handles an unactivated fingerprint response', async () => {
  await withValidationServer(
    async (url, _options, _payload, requests) => {
      if (url.endsWith('/licenses/actions/validate-key')) {
        const validationAttempt = requests.filter((request) =>
          request.url.endsWith('/licenses/actions/validate-key')
        ).length;
        return validationResponse({
          valid: validationAttempt > 1,
          code: validationAttempt > 1 ? 'FINGERPRINT_SCOPE_VALID' : 'NO_MACHINE',
          detail:
            validationAttempt > 1
              ? 'License is valid for this machine.'
              : 'fingerprint is not activated (has no associated machines)'
        });
      }
      if (url.endsWith('/machines')) {
        return machineResponse();
      }
      if (url.endsWith('/licenses/lic_123')) {
        return new Response(JSON.stringify({ data: ACTIVE_LICENSE }), { status: 200 });
      }
      if (url.endsWith('/machines?limit=100')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [{ detail: 'Unexpected request.' }] }), {
        status: 500
      });
    },
    async (server, requests) => {
      const response = await postJson(server, '/api/license/validate', {
        licenseKey: 'FORCEMAP-STAFF',
        machineFingerprint: 'machine-fingerprint-123',
        machineName: 'Mark test computer',
        platform: 'Windows',
        activate: true
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.allowed, true);
      assert.equal(response.body.code, 'FINGERPRINT_SCOPE_VALID');
      assert.equal(requests.length, 5);
      assert.equal(requests[0].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
      assert.equal(requests[1].payload.data.attributes.fingerprint, 'machine-fingerprint-123');
      assert.equal(requests[2].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
      assert.match(requests[3].url, /\/licenses\/lic_123$/);
      assert.match(requests[4].url, /\/machines\?limit=100$/);
    }
  );
});

test('first-time licence activation retrieves a real licence after a generic invalid response', async () => {
  await withValidationServer(
    async (url, _options, _payload, requests) => {
      if (url.endsWith('/licenses/actions/validate-key')) {
        const validationAttempt = requests.filter((request) =>
          request.url.endsWith('/licenses/actions/validate-key')
        ).length;
        return validationResponse({
          valid: validationAttempt > 1,
          code: validationAttempt > 1 ? 'FINGERPRINT_SCOPE_VALID' : undefined,
          detail:
            validationAttempt > 1
              ? 'License is valid for this machine.'
              : 'This licence is not valid.',
          data: validationAttempt > 1 ? ACTIVE_LICENSE : null
        });
      }
      if (url.endsWith('/licenses/FORCEMAP-STAFF')) {
        return new Response(JSON.stringify({ data: ACTIVE_LICENSE }), { status: 200 });
      }
      if (url.endsWith('/machines')) {
        return machineResponse();
      }
      if (url.endsWith('/licenses/lic_123')) {
        return new Response(JSON.stringify({ data: ACTIVE_LICENSE }), { status: 200 });
      }
      if (url.endsWith('/machines?limit=100')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [{ detail: 'Unexpected request.' }] }), {
        status: 500
      });
    },
    async (server, requests) => {
      const response = await postJson(server, '/api/license/validate', {
        licenseKey: 'FORCEMAP-STAFF',
        machineFingerprint: 'machine-fingerprint-123',
        machineName: 'Mark test computer',
        platform: 'Windows',
        activate: true
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.allowed, true);
      assert.equal(response.body.code, 'FINGERPRINT_SCOPE_VALID');
      assert.equal(requests.length, 6);
      assert.equal(requests[0].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
      assert.match(requests[1].url, /\/licenses\/FORCEMAP-STAFF$/);
      assert.equal(requests[2].payload.data.attributes.fingerprint, 'machine-fingerprint-123');
      assert.equal(requests[3].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
      assert.match(requests[4].url, /\/licenses\/lic_123$/);
      assert.match(requests[5].url, /\/machines\?limit=100$/);
    }
  );
});

test('valid monthly licence returns customer profile fields for the desktop app', async () => {
  const monthlyLicense = {
    ...ACTIVE_LICENSE,
    attributes: {
      ...ACTIVE_LICENSE.attributes,
      name: 'fallback@example.com',
      metadata: {
        customerName: 'Mark Ashton',
        customerEmail: 'mark@example.com',
        productType: 'Monthly',
        stripeCurrentPeriodEnd: '2026-07-05T00:00:00.000Z',
        accessStatus: 'active',
        cancellationPending: 'false'
      }
    }
  };
  const machines = [
    {
      id: 'machine_1',
      relationships: {
        license: {
          data: {
            id: 'lic_123',
            type: 'licenses'
          }
        }
      }
    }
  ];

  await withValidationServer(
    async (url) => {
      if (url.endsWith('/licenses/actions/validate-key')) {
        return validationResponse({
          valid: true,
          code: 'VALID',
          detail: 'License is valid.',
          data: monthlyLicense
        });
      }
      if (url.endsWith('/licenses/lic_123')) {
        return new Response(JSON.stringify({ data: monthlyLicense }), { status: 200 });
      }
      if (url.endsWith('/machines?limit=100')) {
        return new Response(JSON.stringify({ data: machines }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [{ detail: 'Unexpected request.' }] }), {
        status: 500
      });
    },
    async (server) => {
      const response = await postJson(server, '/api/license/validate', {
        licenseKey: 'FORCEMAP-MONTHLY',
        machineFingerprint: 'machine-fingerprint-123'
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.allowed, true);
      assert.equal(response.body.productName, 'ForceMap');
      assert.equal(response.body.registeredName, 'Mark Ashton');
      assert.equal(response.body.registeredEmail, 'mark@example.com');
      assert.equal(response.body.planName, 'Pro Monthly');
      assert.equal(response.body.renewsAt, '2026-07-05T00:00:00.000Z');
      assert.equal(response.body.expiresAt, '');
      assert.equal(response.body.deviceCount, '1');
      assert.equal(response.body.billingUrl, '');
    }
  );
});

test('validation does not use a Keygen email name as registered customer name', async () => {
  const emailNamedLicense = {
    ...ACTIVE_LICENSE,
    attributes: {
      ...ACTIVE_LICENSE.attributes,
      name: 'markashtongolf@gmail.com',
      metadata: {
        customerEmail: 'markashtongolf@gmail.com',
        productType: 'Monthly',
        stripeCurrentPeriodEnd: '2026-07-05T00:00:00.000Z',
        accessStatus: 'active',
        cancellationPending: 'false'
      }
    }
  };

  await withValidationServer(
    async (url) => {
      if (url.endsWith('/licenses/actions/validate-key')) {
        return validationResponse({
          valid: true,
          code: 'VALID',
          detail: 'License is valid.',
          data: emailNamedLicense
        });
      }
      if (url.endsWith('/licenses/lic_123')) {
        return new Response(JSON.stringify({ data: emailNamedLicense }), { status: 200 });
      }
      if (url.endsWith('/machines?limit=100')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [{ detail: 'Unexpected request.' }] }), {
        status: 500
      });
    },
    async (server) => {
      const response = await postJson(server, '/api/license/validate', {
        licenseKey: 'FORCEMAP-MONTHLY',
        machineFingerprint: 'machine-fingerprint-123'
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.registeredName, '');
      assert.equal(response.body.registeredEmail, 'markashtongolf@gmail.com');
    }
  );
});

test('valid staff licence returns pro staff with no renewal or expiry', async () => {
  const staffLicense = {
    ...ACTIVE_LICENSE,
    attributes: {
      ...ACTIVE_LICENSE.attributes,
      name: 'Mark Ashton - Staff',
      metadata: {
        customerName: 'Mark Ashton',
        customerEmail: 'mark@ultimategolfeducation.com',
        productType: 'Staff'
      }
    }
  };

  await withValidationServer(
    async (url) => {
      if (url.endsWith('/licenses/actions/validate-key')) {
        return validationResponse({
          valid: true,
          code: 'VALID',
          detail: 'License is valid.',
          data: staffLicense
        });
      }
      if (url.endsWith('/licenses/lic_123')) {
        return new Response(JSON.stringify({ data: staffLicense }), { status: 200 });
      }
      if (url.endsWith('/machines?limit=100')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [{ detail: 'Unexpected request.' }] }), {
        status: 500
      });
    },
    async (server) => {
      const response = await postJson(server, '/api/license/validate', {
        licenseKey: 'FORCEMAP-STAFF',
        machineFingerprint: 'machine-fingerprint-123'
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.planName, 'Pro Staff');
      assert.equal(response.body.registeredName, 'Mark Ashton');
      assert.equal(response.body.registeredEmail, 'mark@ultimategolfeducation.com');
      assert.equal(response.body.renewsAt, '');
      assert.equal(response.body.expiresAt, '');
      assert.equal(response.body.deviceLimit, 'Unlimited');
    }
  );
});

test('cancelled subscription returns access end date instead of renewal date', async () => {
  const cancelledLicense = {
    ...ACTIVE_LICENSE,
    attributes: {
      ...ACTIVE_LICENSE.attributes,
      metadata: {
        customerEmail: 'customer@example.com',
        productType: 'Annual',
        accessStatus: 'active',
        cancellationPending: 'true',
        cancelAccessAt: '2027-06-05T00:00:00.000Z',
        stripeCurrentPeriodEnd: '2027-06-05T00:00:00.000Z'
      }
    }
  };

  await withValidationServer(
    async (url) => {
      if (url.endsWith('/licenses/actions/validate-key')) {
        return validationResponse({
          valid: true,
          code: 'VALID',
          detail: 'License is valid.',
          data: cancelledLicense
        });
      }
      if (url.endsWith('/licenses/lic_123')) {
        return new Response(JSON.stringify({ data: cancelledLicense }), { status: 200 });
      }
      if (url.endsWith('/machines?limit=100')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [{ detail: 'Unexpected request.' }] }), {
        status: 500
      });
    },
    async (server) => {
      const response = await postJson(server, '/api/license/validate', {
        licenseKey: 'FORCEMAP-ANNUAL',
        machineFingerprint: 'machine-fingerprint-123'
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.planName, 'Pro Annual');
      assert.equal(response.body.renewsAt, '');
      assert.equal(response.body.expiresAt, '2027-06-05T00:00:00.000Z');
    }
  );
});

test('suspended licence keeps the original failure behaviour', async () => {
  const suspendedLicense = {
    ...ACTIVE_LICENSE,
    attributes: {
      ...ACTIVE_LICENSE.attributes,
      suspended: true,
      metadata: {
        customerName: 'Suspended Customer',
        customerEmail: 'suspended@example.com'
      }
    }
  };

  await withValidationServer(
    async (url) => {
      if (url.endsWith('/licenses/actions/validate-key')) {
        return validationResponse({
          valid: true,
          code: 'VALID',
          detail: 'License is valid.',
          data: suspendedLicense
        });
      }
      return new Response(JSON.stringify({ errors: [{ detail: 'Unexpected request.' }] }), {
        status: 500
      });
    },
    async (server, requests) => {
      const response = await postJson(server, '/api/license/validate', {
        licenseKey: 'FORCEMAP-SUSPENDED',
        machineFingerprint: 'machine-fingerprint-123'
      });

      assert.equal(response.status, 403);
      assert.equal(response.body.allowed, false);
      assert.equal(response.body.code, 'LICENSE_SUSPENDED');
      assert.equal(response.body.detail, 'This ForceMap license is suspended.');
      assert.equal(response.body.registeredName, undefined);
      assert.equal(requests.length, 1);
    }
  );
});
