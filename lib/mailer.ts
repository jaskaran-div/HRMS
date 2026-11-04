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
