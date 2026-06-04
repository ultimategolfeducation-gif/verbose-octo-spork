import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createApp } from '../src/app.js';

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

test('first-time licence activation validates key before fingerprint', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    KEYGEN_ACCOUNT_ID: process.env.KEYGEN_ACCOUNT_ID,
    KEYGEN_PRODUCT_ID: process.env.KEYGEN_PRODUCT_ID,
    KEYGEN_API_TOKEN: process.env.KEYGEN_API_TOKEN
  };
  const requests = [];

  process.env.KEYGEN_ACCOUNT_ID = 'account_123';
  process.env.KEYGEN_PRODUCT_ID = 'product_123';
  process.env.KEYGEN_API_TOKEN = 'keygen-token';

  globalThis.fetch = async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    requests.push({ url, options, payload });

    if (url.endsWith('/licenses/actions/validate-key')) {
      const hasFingerprint = Boolean(payload.meta?.scope?.fingerprint);
      return new Response(
        JSON.stringify({
          meta: {
            valid: true,
            code: hasFingerprint ? 'FINGERPRINT_SCOPE_VALID' : 'VALID',
            detail: hasFingerprint
              ? 'License is valid for this machine.'
              : 'License is valid.'
          },
          data: {
            id: 'lic_123',
            attributes: {
              status: 'ACTIVE',
              suspended: false
            }
          }
        }),
        { status: 200 }
      );
    }

    if (url.endsWith('/machines')) {
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

    return new Response(JSON.stringify({ errors: [{ detail: 'Unexpected request.' }] }), {
      status: 500
    });
  };

  const server = createApp().listen(0);

  try {
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
    assert.equal(requests[0].payload.meta.key, 'FORCEMAP-STAFF');
    assert.equal(requests[0].payload.meta.scope.fingerprint, undefined);
    assert.equal(requests[1].payload.data.attributes.fingerprint, 'machine-fingerprint-123');
    assert.equal(requests[2].payload.meta.scope.fingerprint, 'machine-fingerprint-123');
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
});
