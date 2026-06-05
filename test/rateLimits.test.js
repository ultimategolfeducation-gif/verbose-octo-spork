import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createApp } from '../src/app.js';
import {
  resetAbuseMonitorForTests,
  setAbuseAlertSenderForTests
} from '../src/abuseMonitor.js';

function requestJson(server, path, { method = 'GET', payload, headers = {} } = {}) {
  const body = payload ? JSON.stringify(payload) : '';
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              ...headers
            }
          : headers
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
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function withServer(callback) {
  resetAbuseMonitorForTests();
  setAbuseAlertSenderForTests(async () => ({}));
  const server = createApp().listen(0);
  try {
    await callback(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetAbuseMonitorForTests();
  }
}

test('health checks are not rate limited', async () => {
  await withServer(async (server) => {
    for (let index = 0; index < 35; index += 1) {
      const response = await requestJson(server, '/health');
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
    }
  });
});

test('licence validation is rate limited per IP address', async () => {
  await withServer(async (server) => {
    for (let index = 0; index < 20; index += 1) {
      const response = await requestJson(server, '/api/license/validate', {
        method: 'POST',
        payload: {}
      });
      assert.equal(response.status, 400);
    }

    const response = await requestJson(server, '/api/license/validate', {
      method: 'POST',
      payload: {}
    });
    assert.equal(response.status, 429);
    assert.equal(response.body.code, 'IP_RATE_LIMITED');
  });
});

test('licence validation is also rate limited per licence key across IP addresses', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    KEYGEN_ACCOUNT_ID: process.env.KEYGEN_ACCOUNT_ID,
    KEYGEN_PRODUCT_ID: process.env.KEYGEN_PRODUCT_ID,
    KEYGEN_POLICY_ID: process.env.KEYGEN_POLICY_ID,
    KEYGEN_API_TOKEN: process.env.KEYGEN_API_TOKEN
  };

  process.env.KEYGEN_ACCOUNT_ID = 'account_123';
  process.env.KEYGEN_PRODUCT_ID = 'product_123';
  process.env.KEYGEN_POLICY_ID = 'policy_123';
  process.env.KEYGEN_API_TOKEN = 'keygen-token';

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        meta: {
          valid: false,
          code: 'NO_MACHINE',
          detail: 'This licence is not activated.'
        },
        data: null
      }),
      { status: 200 }
    );

  try {
    await withServer(async (server) => {
      for (let index = 0; index < 12; index += 1) {
        const response = await requestJson(server, '/api/license/validate', {
          method: 'POST',
          payload: { licenseKey: 'FORCEMAP-CUSTOMER' },
          headers: { 'X-Forwarded-For': `203.0.113.${index + 1}` }
        });
        assert.equal(response.status, 403);
      }

      const response = await requestJson(server, '/api/license/validate', {
        method: 'POST',
        payload: { licenseKey: 'forcemap-customer' },
        headers: { 'X-Forwarded-For': '203.0.113.99' }
      });
      assert.equal(response.status, 429);
      assert.equal(response.body.code, 'LICENSE_RATE_LIMITED');
    });
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

test('billing portal requests have a stricter rate limit', async () => {
  await withServer(async (server) => {
    for (let index = 0; index < 10; index += 1) {
      const response = await requestJson(server, '/api/license/billing-portal', {
        method: 'POST',
        payload: {}
      });
      assert.equal(response.status, 400);
    }

    const response = await requestJson(server, '/api/license/billing-portal', {
      method: 'POST',
      payload: {}
    });
    assert.equal(response.status, 429);
    assert.equal(response.body.code, 'BILLING_RATE_LIMITED');
  });
});

test('billing portal is also rate limited per licence key', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    KEYGEN_ACCOUNT_ID: process.env.KEYGEN_ACCOUNT_ID,
    KEYGEN_PRODUCT_ID: process.env.KEYGEN_PRODUCT_ID,
    KEYGEN_POLICY_ID: process.env.KEYGEN_POLICY_ID,
    KEYGEN_API_TOKEN: process.env.KEYGEN_API_TOKEN
  };

  process.env.KEYGEN_ACCOUNT_ID = 'account_123';
  process.env.KEYGEN_PRODUCT_ID = 'product_123';
  process.env.KEYGEN_POLICY_ID = 'policy_123';
  process.env.KEYGEN_API_TOKEN = 'keygen-token';

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        meta: {
          valid: false,
          code: 'FINGERPRINT_SCOPE_MISMATCH',
          detail: 'This licence is not valid for this machine.'
        },
        data: null
      }),
      { status: 200 }
    );

  try {
    await withServer(async (server) => {
      for (let index = 0; index < 4; index += 1) {
        const response = await requestJson(server, '/api/license/billing-portal', {
          method: 'POST',
          payload: { licenseKey: 'FORCEMAP-CUSTOMER' },
          headers: { 'X-Forwarded-For': `198.51.100.${index + 1}` }
        });
        assert.equal(response.status, 403);
      }

      const response = await requestJson(server, '/api/license/billing-portal', {
        method: 'POST',
        payload: { licenseKey: 'forcemap-customer' },
        headers: { 'X-Forwarded-For': '198.51.100.99' }
      });
      assert.equal(response.status, 429);
      assert.equal(response.body.code, 'BILLING_LICENSE_RATE_LIMITED');
    });
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
