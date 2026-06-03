import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWelcomeEmail } from '../src/email.js';

test('welcome email is sent through MailerSend API', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    MAILERSEND_API_TOKEN: process.env.MAILERSEND_API_TOKEN,
    MAILERSEND_FROM_EMAIL: process.env.MAILERSEND_FROM_EMAIL,
    MAILERSEND_FROM_NAME: process.env.MAILERSEND_FROM_NAME,
    MAILERSEND_REPLY_TO_EMAIL: process.env.MAILERSEND_REPLY_TO_EMAIL,
    MAILERSEND_REPLY_TO_NAME: process.env.MAILERSEND_REPLY_TO_NAME,
    DOWNLOAD_URL: process.env.DOWNLOAD_URL
  };
  let request;

  process.env.MAILERSEND_API_TOKEN = 'test-token';
  process.env.MAILERSEND_FROM_EMAIL = 'software@ultimategolfeducation.com';
  process.env.MAILERSEND_FROM_NAME = 'ForceMap by Ultimate Golf Education';
  process.env.MAILERSEND_REPLY_TO_EMAIL = 'info@ultimategolfeducation.com';
  process.env.MAILERSEND_REPLY_TO_NAME = 'Ultimate Golf Education';
  process.env.DOWNLOAD_URL = 'https://learn.ultimategolfeducation.com/forcemap-download';

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response('', {
      status: 202,
      headers: {
        'x-message-id': 'msg_123'
      }
    });
  };

  try {
    const result = await sendWelcomeEmail({
      email: 'coach@example.com',
      licenseKey: 'FORCEMAP-TEST-KEY'
    });

    const payload = JSON.parse(request.options.body);

    assert.equal(request.url, 'https://api.mailersend.com/v1/email');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.equal(payload.from.email, 'software@ultimategolfeducation.com');
    assert.equal(payload.to[0].email, 'coach@example.com');
    assert.equal(payload.reply_to.email, 'info@ultimategolfeducation.com');
    assert.equal(payload.subject, 'Welcome to ForceMap by Ultimate Golf Education');
    assert.match(payload.text, /FORCEMAP-TEST-KEY/);
    assert.match(
      payload.text,
      /https:\/\/learn\.ultimategolfeducation\.com\/forcemap-download/
    );
    assert.equal(result.messageId, 'msg_123');
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
