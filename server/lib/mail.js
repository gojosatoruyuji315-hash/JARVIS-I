/** Transactional email via Resend's HTTP API; logs to the console when not configured. */
import { config } from './config.js';

export async function sendMail({ to, subject, text, html }) {
  if (!config.mail.resendKey) {
    console.log(`\n[mail] (RESEND_API_KEY not set — printing instead)\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { logged: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.mail.from, to, subject, text, html: html || undefined }),
  });
  if (!r.ok) throw new Error(`Email failed: ${r.status} ${await r.text()}`);
  return r.json();
}
