import nodemailer from 'nodemailer';
import type { Settings } from './types';

/** SMTP login comes from the server environment (.env.local / Vercel), never from the browser or database. */
export const mailConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

export function mailTransport() {
  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export function senderOf(s: Pick<Settings, 'company_name' | 'sender_name' | 'sender_email' | 'reply_to'>) {
  const address = (s.sender_email || 'hr@derivion.in').trim();
  return { from: { name: (s.sender_name || s.company_name).trim(), address }, replyTo: s.reply_to?.trim() || undefined };
}

/**
 * Mail goes only to official company addresses, never personal ones.
 * COMPANY_EMAIL_DOMAINS (comma separated, e.g. "derivion.in,isft.in") lists them; if unset, the domain of the sender address is used.
 */
export function officialDomains(s?: Pick<Settings, 'sender_email'> | null): string[] {
  const env = process.env.COMPANY_EMAIL_DOMAINS;
  const list = env ? env.split(',') : [((s?.sender_email || 'hr@derivion.in').split('@')[1] ?? '')];
  return list.map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}
export function isOfficial(email: string | null | undefined, s?: Pick<Settings, 'sender_email'> | null): boolean {
  const d = (email ?? '').trim().toLowerCase().split('@')[1];
  return !!d && officialDomains(s).some(x => d === x || d.endsWith('.' + x));
}
export const notOfficialMsg = (s?: Pick<Settings, 'sender_email'> | null) =>
  `Not an official company email (only @${officialDomains(s).join(', @')} addresses get mail).`;
