// SERVER ONLY. Emails sent by the platform itself (not by an organization's HR): email verification,
// invitations, ownership transfer, billing problems, Contact Sales. Sent from PLATFORM_SENDER_EMAIL, which must
// be allowed for the SMTP account. Best effort: never throws.
import { mailConfigured, mailTransport } from './mailer';
import { escapeHtml, htmlToText, wrapEmail } from './email-templates';
import { supabaseAdmin } from './supabase/admin';
import type { Org } from './org';

export type SendResult = { ok: true } | { ok: false; error: string };

export const platformName = () => process.env.PLATFORM_NAME || 'HRMS';
const sender = () => ({ name: platformName(), address: process.env.PLATFORM_SENDER_EMAIL || process.env.SMTP_USER || '' });
/** Public address of the web app, for links in emails. */
export const baseUrl = (req?: Request) => (process.env.APP_URL || (req ? new URL(req.url).origin : '')).replace(/\/+$/, '');

const btn = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${escapeHtml(href)}" style="background:#2f6bff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>`;

async function send(to: string, subject: string, body: string, replyTo?: string): Promise<SendResult> {
  if (!mailConfigured()) return { ok: false, error: 'Email is not set up on the server (SMTP settings missing).' };
  const from = sender();
  if (!from.address) return { ok: false, error: 'PLATFORM_SENDER_EMAIL is not set.' };
  const html = wrapEmail(body, platformName());
  try {
    await mailTransport().sendMail({ from, to, replyTo, subject, html, text: htmlToText(html) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function emailVerifyOwner(o: { to: string; name: string; orgName: string; link: string }) {
  return send(o.to, `Verify your email for ${o.orgName}`, `<p><b>Hi ${escapeHtml(o.name)},</b></p>
<p>Thanks for registering <b>${escapeHtml(o.orgName)}</b> on ${escapeHtml(platformName())}. Confirm this is your email address to continue:</p>
${btn(o.link, 'Verify my email')}
<p style="color:#5b6070;font-size:13px">The link works once and expires in 24 hours. If you did not register, ignore this email.</p>`);
}

/** The platform admin created an organization for someone: their login details. */
export function emailOwnerCreated(o: { to: string; name: string; orgName: string; password: string; url: string; pays: boolean }) {
  return send(o.to, `Your ${o.orgName} account on ${platformName()}`, `<p><b>Hi ${escapeHtml(o.name)},</b></p>
<p>An account for <b>${escapeHtml(o.orgName)}</b> has been created for you on ${escapeHtml(platformName())}. You are its owner.</p>
<p>Email: <b>${escapeHtml(o.to)}</b><br>Password: <b>${escapeHtml(o.password)}</b></p>
<p>${o.pays ? 'After logging in, choose your plan in Billing to activate it.' : 'Your organization is active: log in, set it up and invite your team.'} Change this password after your first login.</p>
${btn(`${o.url}/login`, 'Log in')}`);
}

export function emailInvitation(o: { to: string; name: string; orgName: string; inviter: string; roleLabel: string; link: string; days: number }) {
  return send(o.to, `${o.inviter} invited you to ${o.orgName}`, `<p><b>Hi ${escapeHtml(o.name)},</b></p>
<p>${escapeHtml(o.inviter)} has invited you to join <b>${escapeHtml(o.orgName)}</b> on ${escapeHtml(platformName())} as <b>${escapeHtml(o.roleLabel)}</b>.</p>
<p>Choose your password to activate your account. You can then use the same email and password on the web and in the mobile app.</p>
${btn(o.link, 'Accept invitation')}
<p style="color:#5b6070;font-size:13px">The link works once and expires in ${o.days} days. If you were not expecting this, ignore it.</p>`);
}

export function emailOwnershipOffer(o: { to: string; name: string; orgName: string; from: string; link: string }) {
  return send(o.to, `${o.from} wants to make you the owner of ${o.orgName}`, `<p><b>Hi ${escapeHtml(o.name)},</b></p>
<p>${escapeHtml(o.from)} has asked to transfer ownership of <b>${escapeHtml(o.orgName)}</b> to you. As owner you manage the subscription, billing and all administration. ${escapeHtml(o.from)} will become an admin.</p>
${btn(o.link, 'Review and accept')}
<p style="color:#5b6070;font-size:13px">You must be logged in as yourself to accept. The offer expires in 72 hours.</p>`);
}

export function emailOwnershipDone(o: { to: string; name: string; orgName: string; newOwner: string }) {
  return send(o.to, `Ownership of ${o.orgName} was transferred`, `<p><b>Hi ${escapeHtml(o.name)},</b></p>
<p>Ownership of <b>${escapeHtml(o.orgName)}</b> is now with <b>${escapeHtml(o.newOwner)}</b>. Your login is now an admin. If you did not expect this, contact support immediately.</p>`);
}

/** Tells the owner a payment failed, with a link to pay / update the card. */
export async function emailPaymentFailed(org: Org, why: string, invoiceUrl: string | null): Promise<void> {
  if (!org.owner_user_id) return;
  const { data: p } = await supabaseAdmin().from('profiles').select('full_name').eq('id', org.owner_user_id).maybeSingle();
  const to = org.owner_email;
  if (!to) return;
  await send(to, `Payment problem for ${org.name}`, `<p><b>Hi ${escapeHtml(p?.full_name ?? '')},</b></p>
<p>We could not collect the payment for <b>${escapeHtml(org.name)}</b>: ${escapeHtml(why)}</p>
<p>Stripe retries automatically. To avoid losing access, pay the invoice or update your card in Billing.</p>
${invoiceUrl ? btn(invoiceUrl, 'Pay the invoice') : ''}${btn(`${baseUrl()}/billing`, 'Open Billing')}`);
}

export function emailSalesInquiry(i: { name: string; email: string; company?: string | null; phone?: string | null; employees?: string | null; message?: string | null }) {
  const to = process.env.SALES_EMAIL;
  if (!to) return Promise.resolve({ ok: false, error: 'SALES_EMAIL is not set.' } as SendResult);
  const row = (k: string, v?: string | null) => (v ? `<tr><td style="padding:4px 14px 4px 0;color:#5b6070">${k}</td><td><b>${escapeHtml(v)}</b></td></tr>` : '');
  return send(to, `Contact Sales: ${i.company || i.name}`, `<p>New Contact Sales request:</p>
<table>${row('Name', i.name)}${row('Email', i.email)}${row('Company', i.company)}${row('Phone', i.phone)}${row('Employees', i.employees)}</table>
<p style="white-space:pre-wrap">${escapeHtml(i.message ?? '')}</p>`, i.email);
}
