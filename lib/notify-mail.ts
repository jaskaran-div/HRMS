// SERVER ONLY. Account and HR notification emails (login details, password changes, documents, team changes).
// Every function is best effort: it never throws, and returns what happened so the UI can say "emailed to …".
import { supabaseAdmin } from './supabase/admin';
import { isOfficial, mailConfigured, mailTransport, notOfficialMsg, senderOf } from './mailer';
import { escapeHtml, htmlToText, wrapEmail } from './email-templates';
import { hrAddress } from './leave-mail';
import { officialEmailOf } from './official-email';
import type { Profile, Role, Settings } from './types';

export type MailResult = { ok: true; to: string[] } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = (e?: string | null): e is string => !!e && EMAIL.test(e.trim());
export const NO_SMTP = 'Email is not set up on the server (SMTP settings missing).';

const ROLE_NAME: Record<Role, string> = { owner: 'Owner', admin: 'Admin', hr_admin: 'HR admin', editor: 'HR editor', viewer: 'HR viewer', team_lead: 'Team leader', employee: 'Employee' };

/** The public address of the portal: APP_URL if set (needed behind proxies), else the address the request came in on. */
export const appUrl = (req: Request) => (process.env.APP_URL || new URL(req.url).origin).replace(/\/+$/, '');

const btn = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${escapeHtml(href)}" style="background:#2f6bff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>`;

export function table(rows: [string, string][]) {
  return `<table style="border-collapse:collapse;margin:8px 0 14px">${rows.map(([k, v]) =>
    `<tr><td style="padding:4px 14px 4px 0;color:#5b6070">${escapeHtml(k)}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`).join('')}</table>`;
}

const cached = new Map<string, { at: number; s: Settings }>();
/** The organization's settings (sender address, company name, official domains). Cached for 30 s. */
async function settings(orgId: string): Promise<Settings | null> {
  const c = cached.get(orgId);
  if (c && Date.now() - c.at < 30_000) return c.s;
  const { data } = await supabaseAdmin().from('settings').select('*').eq('org_id', orgId).maybeSingle();
  if (data) cached.set(orgId, { at: Date.now(), s: data as Settings });
  return (data as Settings) ?? null;
}

/** Sends one branded email. `to` is filtered to valid, unique addresses. */
export async function sendNotice(orgId: string, to: (string | null | undefined)[], subject: string, bodyHtml: string, replyTo?: string | null): Promise<MailResult> {
  if (!mailConfigured()) return { ok: false, error: NO_SMTP };
  const s = await settings(orgId);
  if (!s) return { ok: false, error: 'Company settings missing.' };
  const given = to.filter(validEmail);
  const list = [...new Set(given.filter(x => isOfficial(x, s)).map(x => x.trim().toLowerCase()))];
  if (!list.length) return { ok: false, error: given.length ? notOfficialMsg(s) : 'No email address on file.' };
  const html = wrapEmail(bodyHtml + `<p style="color:#5b6070;font-size:13px">Regards,<br>HR, ${escapeHtml(s.company_name)}</p>`, s.company_name);
  const sender = senderOf(s);
  try {
    await mailTransport().sendMail({
      from: sender.from, to: list, replyTo: validEmail(replyTo) ? replyTo.trim() : sender.replyTo ?? hrAddress(s) ?? undefined,
      subject, html, text: htmlToText(html),
    });
    return { ok: true, to: list };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Where a login's account emails go: the address saved on the login, else the linked employee's email. */
export async function accountAddress(p: Pick<Profile, 'email' | 'employee_id'>): Promise<string | null> {
  if (validEmail(p.email)) return p.email.trim();
  if (!p.employee_id) return null;
  const { data } = await supabaseAdmin().from('employees').select('email, extra').eq('id', p.employee_id).maybeSingle();
  return officialEmailOf(data);
}

/** New login or a password set / reset by HR: sends the username, password and the login link. */
export async function emailLoginDetails(o: {
  to: string | null; name: string; username: string; password: string; role: Role; mustChange: boolean; url: string; kind: 'new' | 'reset';
}, orgId: string): Promise<MailResult> {
  const s = await settings(orgId);
  const company = s?.company_name ?? 'HR Portal';
  const intro = o.kind === 'new'
    ? `<p>An account has been created for you on the <b>${escapeHtml(company)} HR Portal</b>. There you can see your details, attendance and payslips${o.role === 'team_lead' ? ', your team' : ''} and apply for leave.</p>`
    : `<p>HR has set a new password for your <b>${escapeHtml(company)} HR Portal</b> account.</p>`;
  const body = `<p><b>Hi ${escapeHtml(o.name)},</b></p>${intro}
${table([['Login page', `${o.url}/login`], ['Username', o.username], ['Password', o.password], ...(o.kind === 'new' ? [['Access', ROLE_NAME[o.role]] as [string, string]] : [])])}
${o.mustChange
    ? '<p style="background:#fff7e6;border-radius:8px;padding:10px 14px"><b>You will be asked to change this password after your first login.</b> Choose one only you know — at least 8 characters.</p>'
    : '<p>For your safety, change this password after logging in (menu at the top right → Change password).</p>'}
${btn(`${o.url}/login`, 'Log in to the HR Portal')}
<p style="color:#5b6070;font-size:13px">Never share your password. HR will never ask you for it. If you did not expect this email, tell HR.</p>`;
  return sendNotice(orgId, [o.to], o.kind === 'new' ? `Your ${company} HR Portal login` : `Your ${company} HR Portal password was reset`, body);
}

/** Security notice after someone changes their own password. */
export async function emailPasswordChanged(p: Profile, url: string): Promise<MailResult> {
  const to = await accountAddress(p);
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  return sendNotice(p.org_id, [to], 'Your HR Portal password was changed', `<p><b>Hi ${escapeHtml(p.full_name)},</b></p>
<p>The password for your HR Portal login <b>${escapeHtml(p.username)}</b> was changed on ${escapeHtml(when)}.</p>
<p>If this was you, nothing else to do. <b>If it was not you, tell HR immediately</b> so they can lock the account.</p>
${btn(`${url}/login`, 'Open the HR Portal')}`);
}

/** Login disabled / enabled again. */
export async function emailAccountStatus(p: Profile, active: boolean, url: string): Promise<MailResult> {
  const to = await accountAddress(p);
  return sendNotice(p.org_id, [to], active ? 'Your HR Portal login is active again' : 'Your HR Portal login was disabled', `<p><b>Hi ${escapeHtml(p.full_name)},</b></p>
${active
    ? `<p>Your HR Portal login <b>${escapeHtml(p.username)}</b> has been enabled again. You can log in with your existing password.</p>${btn(`${url}/login`, 'Log in')}`
    : `<p>Your HR Portal login <b>${escapeHtml(p.username)}</b> has been disabled by HR. Contact HR if you think this is a mistake.</p>`}`);
}

/** A document was shared with one employee. */
export async function emailDocumentShared(employeeId: string, title: string, category: string | null, url: string): Promise<MailResult> {
  const { data: e } = await supabaseAdmin().from('employees').select('name, email, extra, org_id').eq('id', employeeId).maybeSingle();
  if (!e) return { ok: false, error: 'Employee not found.' };
  return sendNotice(e.org_id as string, [officialEmailOf(e)], `New document: ${title}`, `<p><b>Hi ${escapeHtml(e.name)},</b></p>
<p>HR has added a document to your HR Portal account:</p>
${table([['Document', title], ...(category ? [['Category', category] as [string, string]] : [])])}
${btn(`${url}/portal/documents`, 'Open my documents')}`);
}

/** A new company document everyone can see: one email per active employee with a login (BCC in small batches). */
export async function emailCompanyDocument(orgId: string, title: string, category: string | null, url: string): Promise<MailResult> {
  if (!mailConfigured()) return { ok: false, error: NO_SMTP };
  const admin = supabaseAdmin();
  const { data: logins } = await admin.from('profiles').select('employee_id').eq('org_id', orgId).eq('active', true).not('employee_id', 'is', null);
  const ids = (logins ?? []).map(l => l.employee_id as string);
  if (!ids.length) return { ok: false, error: 'No employee logins yet.' };
  const emails: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('employees').select('email, extra').eq('org_id', orgId).in('id', ids.slice(i, i + 200)).is('archived_at', null);
    for (const r of data ?? []) { const m = officialEmailOf(r); if (m) emails.push(m.toLowerCase()); }
  }
  const s = await settings(orgId);
  if (!s) return { ok: false, error: 'Company settings missing.' };
  const list = [...new Set(emails)].filter(x => isOfficial(x, s));
  if (!list.length) return { ok: false, error: 'No employee has an official company email on file.' };
  const body = `<p><b>Hello,</b></p><p>HR has published a new company document on the HR Portal:</p>
${table([['Document', title], ...(category ? [['Category', category] as [string, string]] : [])])}
${btn(`${url}/portal/documents`, 'Read it in the HR Portal')}<p style="color:#5b6070;font-size:13px">Regards,<br>HR, ${escapeHtml(s.company_name)}</p>`;
  const html = wrapEmail(body, s.company_name);
  const sender = senderOf(s);
  const sent: string[] = [];
  let lastErr = '';
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    try {
      await mailTransport().sendMail({ from: sender.from, to: sender.from, bcc: chunk, replyTo: sender.replyTo, subject: `New company document: ${title}`, html, text: htmlToText(html) });
      sent.push(...chunk);
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  return sent.length ? { ok: true, to: sent } : { ok: false, error: lastErr || 'Could not send.' };
}

/** HR moved people under a team leader: each person hears who they report to; the leader gets the list. */
export async function emailTeamAssigned(orgId: string, employeeIds: string[], leadId: string | null, url: string): Promise<{ sent: number; error?: string }> {
  if (!mailConfigured()) return { sent: 0, error: NO_SMTP };
  const admin = supabaseAdmin();
  const { data: emps } = await admin.from('employees').select('id, name, emp_code, email, extra, team_lead_id').eq('org_id', orgId).in('id', employeeIds.slice(0, 500));
  const moved = (emps ?? []).filter(e => e.team_lead_id === leadId); // only what is really saved
  if (!moved.length) return { sent: 0 };
  const { data: lead } = leadId ? await admin.from('employees').select('name, email, extra, designation').eq('id', leadId).eq('org_id', orgId).maybeSingle() : { data: null };
  let sent = 0;
  for (const e of moved) {
    const r = await sendNotice(orgId, [officialEmailOf(e)], lead ? `You now report to ${lead.name}` : 'Your team leader was removed', `<p><b>Hi ${escapeHtml(e.name)},</b></p>
${lead
      ? `<p>HR has updated the team structure. Your team leader is now <b>${escapeHtml(lead.name)}</b>${lead.designation ? ` (${escapeHtml(lead.designation)})` : ''}. Your leave requests will go to them and to HR.</p>`
      : '<p>HR has updated the team structure: you currently have no team leader. Your leave requests go to HR directly.</p>'}
${btn(`${url}/portal`, 'Open the HR Portal')}`);
    if (r.ok) sent++;
  }
  if (lead && officialEmailOf(lead)) {
    const r = await sendNotice(orgId, [officialEmailOf(lead)], `${moved.length} ${moved.length === 1 ? 'person was' : 'people were'} added to your team`, `<p><b>Hi ${escapeHtml(lead.name)},</b></p>
<p>HR has added the following to your team. You can see their details and approve their leave in the HR Portal.</p>
<ul>${moved.map(e => `<li>${escapeHtml(e.name)} (${escapeHtml(e.emp_code)})</li>`).join('')}</ul>
${btn(`${url}/portal/team`, 'Open my team')}`);
    if (r.ok) sent++;
  }
  return { sent };
}
