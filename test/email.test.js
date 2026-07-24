import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sendAbuseAlertEmail,
  sendAccessRestoredEmail,
  sendCancellationEmail,
  sendSuspendedEmail,
  sendWelcomeEmail
} from '../src/email.js';

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
  process.env.MAILERSEND_FROM_NAME = 'ForceMap™ by Ultimate Golf Education';
  process.env.MAILERSEND_REPLY_TO_EMAIL = 'info@ultimategolfeducation.com';
  process.env.MAILERSEND_REPLY_TO_NAME = 'Ultimate Golf Education';
  process.env.DOWNLOAD_URL = 'https://info.forcemap.com.au/forcemap-download';

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
    assert.equal(payload.subject, 'Welcome to ForceMap™ by Ultimate Golf Education');
    assert.match(payload.text, /FORCEMAP-TEST-KEY/);
    assert.match(payload.html, /Ultimate Golf Education/);
    assert.match(payload.html, /ForceMap/);
    assert.doesNotMatch(payload.html, /MailerSend/i);
    assert.match(
      payload.text,
      /https:\/\/info\.forcemap\.com\.au\/forcemap-download/
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

test('abuse alert email is sent to the configured support inbox', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    MAILERSEND_API_TOKEN: process.env.MAILERSEND_API_TOKEN,
    MAILERSEND_FROM_EMAIL: process.env.MAILERSEND_FROM_EMAIL,
    MAILERSEND_FROM_NAME: process.env.MAILERSEND_FROM_NAME,
    MAILERSEND_REPLY_TO_EMAIL: process.env.MAILERSEND_REPLY_TO_EMAIL,
    MAILERSEND_REPLY_TO_NAME: process.env.MAILERSEND_REPLY_TO_NAME,
    ABUSE_ALERT_EMAIL: process.env.ABUSE_ALERT_EMAIL
  };
  let request;

  process.env.MAILERSEND_API_TOKEN = 'test-token';
  process.env.MAILERSEND_FROM_EMAIL = 'software@ultimategolfeducation.com';
  process.env.MAILERSEND_FROM_NAME = 'ForceMap™ by Ultimate Golf Education';
  process.env.MAILERSEND_REPLY_TO_EMAIL = 'info@ultimategolfeducation.com';
  process.env.MAILERSEND_REPLY_TO_NAME = 'Ultimate Golf Education';
  process.env.ABUSE_ALERT_EMAIL = 'info@ultimategolfeducation.com';

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response('', {
      status: 202,
      headers: {
        'x-message-id': 'msg_alert_123'
      }
    });
  };

  try {
    const result = await sendAbuseAlertEmail({
      subject: 'ForceMap licence alert: activation limit reached',
      text: 'Alert text'
    });
    const payload = JSON.parse(request.options.body);

    assert.equal(request.url, 'https://api.mailersend.com/v1/email');
    assert.equal(payload.to[0].email, 'info@ultimategolfeducation.com');
    assert.equal(payload.subject, 'ForceMap licence alert: activation limit reached');
    assert.equal(payload.text, 'Alert text');
    assert.equal(result.messageId, 'msg_alert_123');
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

test('ForceMap customer templates include branded HTML and plain text without MailerSend branding', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    MAILERSEND_API_TOKEN: process.env.MAILERSEND_API_TOKEN,
    MAILERSEND_FROM_EMAIL: process.env.MAILERSEND_FROM_EMAIL,
    MAILERSEND_FROM_NAME: process.env.MAILERSEND_FROM_NAME,
    MAILERSEND_REPLY_TO_EMAIL: process.env.MAILERSEND_REPLY_TO_EMAIL,
    MAILERSEND_REPLY_TO_NAME: process.env.MAILERSEND_REPLY_TO_NAME,
    DOWNLOAD_URL: process.env.DOWNLOAD_URL
  };
  const payloads = [];

  process.env.MAILERSEND_API_TOKEN = 'test-token';
  process.env.MAILERSEND_FROM_EMAIL = 'software@ultimategolfeducation.com';
  process.env.MAILERSEND_FROM_NAME = 'ForceMap™ by Ultimate Golf Education';
  process.env.MAILERSEND_REPLY_TO_EMAIL = 'info@ultimategolfeducation.com';
  process.env.MAILERSEND_REPLY_TO_NAME = 'Ultimate Golf Education';
  process.env.DOWNLOAD_URL = 'https://info.forcemap.com.au/forcemap-download';

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.mailersend.com/v1/email');
    payloads.push(JSON.parse(options.body));
    return new Response('', {
      status: 202,
      headers: {
        'x-message-id': `msg_${payloads.length}`
      }
    });
  };

  try {
    await sendWelcomeEmail({
      email: 'coach@example.com',
      licenseKey: 'FORCEMAP-TEST-KEY'
    });
    await sendCancellationEmail({
      email: 'coach@example.com',
      accessEndsAt: '2026-08-12T00:00:00.000Z'
    });
    await sendSuspendedEmail({ email: 'coach@example.com' });
    await sendAccessRestoredEmail({ email: 'coach@example.com' });

    assert.deepEqual(
      payloads.map((payload) => payload.subject),
      [
        'Welcome to ForceMap™ by Ultimate Golf Education',
        'ForceMap access after cancellation',
        'ForceMap access suspended',
        'ForceMap access restored'
      ]
    );

    for (const payload of payloads) {
      assert.equal(payload.from.email, 'software@ultimategolfeducation.com');
      assert.equal(payload.from.name, 'ForceMap™ by Ultimate Golf Education');
      assert.equal(payload.reply_to.email, 'info@ultimategolfeducation.com');
      assert.equal(payload.reply_to.name, 'Ultimate Golf Education');
      assert.equal(payload.to[0].email, 'coach@example.com');
      assert.match(payload.text, /Ultimate Golf Education/);
      assert.match(payload.text, /ForceMap™ software support/);
      assert.match(payload.text, /info@ultimategolfeducation\.com/);
      assert.match(payload.html, /Ultimate Golf Education/);
      assert.match(payload.html, /ForceMap/);
      assert.doesNotMatch(payload.text, /MailerSend|Delivered by|via MailerSend|unsubscribe/i);
      assert.doesNotMatch(payload.html, /MailerSend|Delivered by|via MailerSend|unsubscribe/i);
    }
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
