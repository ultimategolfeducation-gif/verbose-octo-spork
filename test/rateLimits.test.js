import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createApp } from '../src/app.js';

function requestJson(server, path, { method = 'GET', payload } = {}) {
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
              'Content-Length': Buffer.byteLength(body)
            }
          : undefined
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
  const server = createApp().listen(0);
  try {
    await callback(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
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
    for (let index = 0; index < 30; index += 1) {
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
    assert.equal(response.body.code, 'RATE_LIMITED');
  });
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
    assert.equal(response.body.code, 'RATE_LIMITED');
  });
});
