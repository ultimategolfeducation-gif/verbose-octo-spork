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
      assert.equal(requests.length, 3);
      assert.equal(requests[0].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
      assert.equal(requests[1].payload.data.attributes.fingerprint, 'machine-fingerprint-123');
      assert.equal(requests[2].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
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
      assert.equal(requests.length, 4);
      assert.equal(requests[0].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
      assert.match(requests[1].url, /\/licenses\/FORCEMAP-STAFF$/);
      assert.equal(requests[2].payload.data.attributes.fingerprint, 'machine-fingerprint-123');
      assert.equal(requests[3].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
    }
  );
});
