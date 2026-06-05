import { getConfig } from './config.js';

const MAILERSEND_EMAIL_URL = 'https://api.mailersend.com/v1/email';

async function responseBody(response) {
  const text = await response.text();
  if (!text) {
    return '';
  }

  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

async function sendMail({ to, subject, text }) {
  const config = getConfig();
  const response = await fetch(MAILERSEND_EMAIL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mailerSendApiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: {
        email: config.mailerSendFromEmail,
        name: config.mailerSendFromName
      },
      to: [{ email: to }],
      reply_to: {
        email: config.mailerSendReplyToEmail,
        name: config.mailerSendReplyToName
      },
      subject,
      text
    })
  });

  if (!response.ok) {
    throw new Error(
      `MailerSend email failed with ${response.status}: ${await responseBody(response)}`
    );
  }

  return {
    messageId: response.headers.get('x-message-id') || '',
    sendPaused: response.headers.get('x-send-paused') === 'true',
    subject,
    to
  };
}

export async function sendWelcomeEmail({ email, licenseKey }) {
  return sendMail({
    to: email,
    subject: 'Welcome to ForceMap by Ultimate Golf Education',
    text: `Thank you for subscribing to ForceMap by Ultimate Golf Education.

Download:
${getConfig().downloadUrl}

License Key:
${licenseKey}

Support:
info@ultimategolfeducation.com`
  });
}

export async function sendPaymentFailedEmail({ email }) {
  return sendMail({
    to: email,
    subject: 'ForceMap payment could not be processed',
    text: `We could not process your ForceMap subscription payment.

Your ForceMap license will remain active for a 48-hour grace period. Please update your payment details in Stripe to keep access uninterrupted.

Support:
info@ultimategolfeducation.com`
  });
}

export async function sendPaymentReminderEmail({ email }) {
  return sendMail({
    to: email,
    subject: 'Reminder: ForceMap payment still needs attention',
    text: `Your ForceMap subscription payment is still outstanding.

Your license is still active during the grace period. Please update your payment details as soon as possible to avoid suspension.

Support:
info@ultimategolfeducation.com`
  });
}

export async function sendSuspendedEmail({ email }) {
  return sendMail({
    to: email,
    subject: 'ForceMap subscription suspended',
    text: `Your ForceMap subscription remains unpaid after the grace period, so your license has been suspended.

To reactivate ForceMap, please update your payment details or contact support.

Support:
info@ultimategolfeducation.com`
  });
}

export async function sendCancellationEmail({ email, accessEndsAt }) {
  return sendMail({
    to: email,
    subject: 'ForceMap subscription cancellation confirmed',
    text: `Your ForceMap subscription cancellation has been confirmed.

Access remains active until:
${accessEndsAt}

After that date, your license will be suspended. To reactivate ForceMap later, restart your subscription or contact support.

Support:
info@ultimategolfeducation.com`
  });
}

export async function sendAbuseAlertEmail({ subject, text }) {
  return sendMail({
    to: getConfig().abuseAlertEmail,
    subject,
    text
  });
}
