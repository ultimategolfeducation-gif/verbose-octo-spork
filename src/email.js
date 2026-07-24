import { getConfig } from './config.js';

const MAILERSEND_EMAIL_URL = 'https://api.mailersend.com/v1/email';
const PRODUCT_NAME = 'ForceMap™ by Ultimate Golf Education';
const PRODUCT_SHORT_NAME = 'ForceMap™';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function forceMapSignature() {
  return [
    'Regards,',
    'Ultimate Golf Education',
    `${PRODUCT_SHORT_NAME} software support`,
    'info@ultimategolfeducation.com'
  ];
}

function textEmail(paragraphs) {
  return [...paragraphs, ...forceMapSignature()].join('\n\n');
}

function htmlEmail(paragraphs) {
  const body = paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7f8;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:28px 32px 16px 32px;border-bottom:3px solid #111827;">
                <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;">Ultimate Golf Education</div>
                <div style="font-size:24px;line-height:1.2;font-weight:700;color:#111827;margin-top:4px;">${PRODUCT_NAME}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;font-size:15px;line-height:1.55;color:#111827;">
                ${body}
                <p style="margin-top:28px;">Regards,<br>
                Ultimate Golf Education<br>
                ${PRODUCT_SHORT_NAME} software support<br>
                <a href="mailto:info@ultimategolfeducation.com" style="color:#111827;">info@ultimategolfeducation.com</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

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

async function sendMail({ to, subject, text, html }) {
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
      text,
      html
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
  const downloadUrl = getConfig().downloadUrl;
  const paragraphs = [
    `Welcome to ${PRODUCT_NAME}.`,
    `Your ${PRODUCT_SHORT_NAME} licence is ready. Download the installer here:\n${downloadUrl}`,
    `Licence key:\n${licenseKey}`,
    `Keep this licence key somewhere safe. You will need it when you activate ${PRODUCT_SHORT_NAME} on a computer.`
  ];

  return sendMail({
    to: email,
    subject: `Welcome to ${PRODUCT_NAME}`,
    text: textEmail(paragraphs),
    html: htmlEmail(paragraphs)
  });
}

export async function sendPaymentFailedEmail({ email }) {
  const paragraphs = [
    'We could not process your ForceMap subscription payment.',
    'Your ForceMap licence remains active during the short grace period. Please update your payment details in Stripe to keep access uninterrupted.'
  ];

  return sendMail({
    to: email,
    subject: 'ForceMap payment could not be processed',
    text: textEmail(paragraphs),
    html: htmlEmail(paragraphs)
  });
}

export async function sendPaymentReminderEmail({ email }) {
  const paragraphs = [
    'Your ForceMap subscription payment is still outstanding.',
    'Your licence is still active during the grace period. Please update your payment details as soon as possible to avoid suspension.'
  ];

  return sendMail({
    to: email,
    subject: 'Reminder: ForceMap payment still needs attention',
    text: textEmail(paragraphs),
    html: htmlEmail(paragraphs)
  });
}

export async function sendSuspendedEmail({ email }) {
  const paragraphs = [
    'Your ForceMap licence has been suspended because the subscription payment remains unresolved after the grace period.',
    'To restore access, update your payment details through Stripe or contact support.'
  ];

  return sendMail({
    to: email,
    subject: 'ForceMap access suspended',
    text: textEmail(paragraphs),
    html: htmlEmail(paragraphs)
  });
}

export async function sendAccessRestoredEmail({ email }) {
  const paragraphs = [
    'Your ForceMap access has been restored.',
    'Your licence should validate normally the next time ForceMap checks in. If ForceMap is already open, restart the app or run a fresh licence check.'
  ];

  return sendMail({
    to: email,
    subject: 'ForceMap access restored',
    text: textEmail(paragraphs),
    html: htmlEmail(paragraphs)
  });
}

export async function sendCancellationEmail({ email, accessEndsAt }) {
  const paragraphs = [
    'Your ForceMap subscription cancellation has been recorded.',
    `Your ForceMap licence remains active until:\n${accessEndsAt}`,
    'After that date, the licence will be suspended. To use ForceMap again later, restart your subscription or contact support.'
  ];

  return sendMail({
    to: email,
    subject: 'ForceMap access after cancellation',
    text: textEmail(paragraphs),
    html: htmlEmail(paragraphs)
  });
}

export async function sendAbuseAlertEmail({ subject, text }) {
  return sendMail({
    to: getConfig().abuseAlertEmail,
    subject,
    text
  });
}
