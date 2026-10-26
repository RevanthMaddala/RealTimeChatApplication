// Outgoing email. Uses SMTP when configured; otherwise (dev only, config.js enforces
// this) prints each message to the console so flows like password reset can be tested.
import nodemailer from 'nodemailer';
import { config } from './config.js';

const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;

export async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    console.log(`[mail] (SMTP not configured, not sent)\n  To: ${to}\n  Subject: ${subject}\n\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.mailFrom, to, subject, text, html });
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function sendPasswordResetMail(user, link) {
  const minutes = Math.round(config.resetTtlMs / 60_000);
  const name = user.displayName || user.username;
  return sendMail({
    to: user.email,
    subject: 'Reset your Relay password',
    text:
      `Hi ${name},\n\nSomeone asked to reset the password for your Relay account (@${user.username}).\n` +
      `Open this link to choose a new one. It expires in ${minutes} minutes and works once:\n\n${link}\n\n` +
      `If you didn't ask for this, you can ignore this email; your password won't change.`,
    html:
      `<p>Hi ${escapeHtml(name)},</p>` +
      `<p>Someone asked to reset the password for your Relay account (@${escapeHtml(user.username)}).</p>` +
      `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>` +
      `<p>The link expires in ${minutes} minutes and works once. If you didn't ask for this, you can ignore this email; your password won't change.</p>`,
  });
}
