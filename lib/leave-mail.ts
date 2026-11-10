// SERVER ONLY. Leave emails: the request goes to the team leader + HR; the decision goes back to the employee.
import { supabaseAdmin } from './supabase/admin';
import { isOfficial, mailConfigured, mailTransport, notOfficialMsg, senderOf } from './mailer';
import { escapeHtml, htmlToText, wrapEmail } from './email-templates';
import { fmtDate } from './dates';
import { leaveLabel, stageText, STATUS_LABEL } from './leave';
import { officialEmailOf } from './official-email';
import type { LeaveRequest, Settings } from './types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const valid = (e?: string | null) => !!e && EMAIL.test(e.trim());

type Emp = { id: string; name: string; emp_code: string; email: string | null; department: string | null; team_lead_id: string | null };

const when = (l: LeaveRequest) =>
  l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`;

function table(rows: [string, string][]) {
  return `<table style="border-collapse:collapse;margin:8px 0 14px">${rows.map(([k, v]) =>
    `<tr><td style="padding:4px 14px 4px 0;color:#5b6070">${escapeHtml(k)}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`).join('')}</table>`;
}

/** HR inbox: the dedicated leave address, else reply-to, else the sender address. */
export const hrAddress = (s: Settings) => [s.hr_email, s.reply_to, s.sender_email].find(valid)?.trim() ?? null;

/** Emails a leave request to the employee's team leader and HR. Records who it went to. */
export async function emailLeaveRequest(l: LeaveRequest, origin: string): Promise<{ ok: true; to: string[] } | { ok: false; error: string }> {
  if (!mailConfigured()) return { ok: false, error: 'Email is not set up on the server yet (SMTP settings missing). Your request is saved; tell HR directly.' };
  const admin = supabaseAdmin();
  const [{ data: settings }, { data: emp }] = await Promise.all([
    admin.from('settings').select('*').eq('id', 1).single(),
    admin.from('employees').select('id, name, emp_code, email, extra, department, team_lead_id').eq('id', l.employee_id).maybeSingle(),
  ]);
  if (!settings || !emp) return { ok: false, error: 'Employee not found.' };
  const s = settings as Settings;
  const e = { ...(emp as Emp), email: officialEmailOf(emp) };
  const { data: leadRow } = e.team_lead_id
    ? await admin.from('employees').select('name, email, extra').eq('id', e.team_lead_id).maybeSingle()
    : { data: null };
  const lead = leadRow ? { name: leadRow.name as string, email: officialEmailOf(leadRow) } : null;

  const given = [lead?.email, hrAddress(s)].filter(valid);
  const to = [...new Set(given.filter(x => isOfficial(x, s)).map(x => x!.trim().toLowerCase()))];
  if (!to.length) return { ok: false, error: given.length ? notOfficialMsg(s) : 'No team leader or HR email address is set up. Ask HR to add one.' };

  const body = `<p><b>Hello${lead?.name ? ` ${escapeHtml(lead.name)}` : ''},</b></p>
<p>${escapeHtml(e.name)} has applied for leave:</p>
${table([
    ['Employee', `${e.name} (${e.emp_code})`], ...(e.department ? [['Department', e.department] as [string, string]] : []),
    ['Leave type', leaveLabel(l.leave_type)], ['Date(s)', when(l)], ['Working days', String(l.days)],
    ['Reason', l.reason?.trim() || '—'],
  ])}
${l.tl_status === 'pending'
    ? `<p>Both the team leader and HR approve or decline it in the HR Portal — team leader: <a href="${escapeHtml(origin)}/portal/approvals" style="color:#127a5f">Leave approvals</a>, HR: <a href="${escapeHtml(origin)}/leaves" style="color:#127a5f">Leave history</a>.</p>`
    : `<p>HR approves or declines it in the HR Portal: <a href="${escapeHtml(origin)}/leaves" style="color:#127a5f">Leave history</a>.</p>`}`;
  const html = wrapEmail(body, s.company_name);
  const { from, replyTo } = senderOf(s);
  try {
    await mailTransport().sendMail({
      from, to, replyTo: valid(e.email) && isOfficial(e.email, s) ? e.email!.trim() : replyTo,
      subject: `Leave request: ${e.name} — ${leaveLabel(l.leave_type)}, ${when(l)}`,
      html, text: htmlToText(html),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  await admin.from('leave_requests').update({ emailed_at: new Date().toISOString(), emailed_to: to.join(', ') }).eq('id', l.id);
  return { ok: true, to };
}

/** Tells the employee their request was approved / rejected. Best effort: failures are ignored. */
export async function emailLeaveDecision(l: LeaveRequest): Promise<void> {
  if (!mailConfigured()) return;
  const admin = supabaseAdmin();
  const [{ data: settings }, { data: emp }] = await Promise.all([
    admin.from('settings').select('*').eq('id', 1).single(),
    admin.from('employees').select('name, email, extra').eq('id', l.employee_id).maybeSingle(),
  ]);
  const to = officialEmailOf(emp);
  if (!settings || !emp || !to || !isOfficial(to, settings as Settings)) return;
  const s = settings as Settings;
  const body = `<p><b>Hi ${escapeHtml(emp.name)},</b></p>
<p>Your leave request has been <b>${STATUS_LABEL[l.status].toLowerCase()}</b>: ${escapeHtml(stageText(l))}.</p>
${table([
    ['Leave type', leaveLabel(l.leave_type)], ['Date(s)', when(l)], ['Working days', String(l.days)],
    ...(l.tl_note ? [['Team leader note', l.tl_note] as [string, string]] : []),
    ...(l.hr_note ? [['HR note', l.hr_note] as [string, string]] : []),
  ])}`;
  const html = wrapEmail(body, s.company_name);
  const { from, replyTo } = senderOf(s);
  try {
    await mailTransport().sendMail({
      from, replyTo, to,
      subject: `Leave ${STATUS_LABEL[l.status].toLowerCase()}: ${leaveLabel(l.leave_type)}, ${when(l)}`, html, text: htmlToText(html),
    });
  } catch { /* the decision is saved either way */ }
}

/** The employee, their team leader and the HR inbox for one request. */
async function parties(l: LeaveRequest) {
  const admin = supabaseAdmin();
  const [{ data: settings }, { data: emp }] = await Promise.all([
    admin.from('settings').select('*').eq('id', 1).single(),
    admin.from('employees').select('id, name, emp_code, email, extra, department, team_lead_id').eq('id', l.employee_id).maybeSingle(),
  ]);
  if (!settings || !emp) return null;
  const e = { ...(emp as Emp), email: officialEmailOf(emp) };
  const { data: lead } = e.team_lead_id
    ? await admin.from('employees').select('name, email, extra').eq('id', e.team_lead_id).maybeSingle()
    : { data: null };
  return { s: settings as Settings, e, lead: lead ? { name: lead.name as string, email: officialEmailOf(lead) } : null };
}

async function send(s: Settings, to: (string | null | undefined)[], subject: string, body: string, replyTo?: string | null) {
  const list = [...new Set(to.filter(valid).filter(x => isOfficial(x, s)).map(x => x!.trim().toLowerCase()))];
  if (!list.length) return;
  const html = wrapEmail(body, s.company_name);
  const sender = senderOf(s);
  try {
    await mailTransport().sendMail({ from: sender.from, to: list, replyTo: valid(replyTo) && isOfficial(replyTo, s) ? replyTo!.trim() : sender.replyTo, subject, html, text: htmlToText(html) });
  } catch { /* best effort */ }
}

/**
 * One approval step was decided while the other is still open: tell whoever is next.
 * Team leader decided → HR; HR decided first → the team leader.
 */
export async function emailLeaveStep(l: LeaveRequest, step: 'hr' | 'tl', origin: string): Promise<void> {
  if (!mailConfigured() || l.status !== 'pending') return;
  const p = await parties(l);
  if (!p) return;
  const nextIsHr = step === 'tl' && l.hr_status === 'pending';
  const nextIsTl = step === 'hr' && l.tl_status === 'pending';
  if (!nextIsHr && !nextIsTl) return;
  const who = step === 'tl' ? `Team leader ${l.tl_by_name ?? ''}`.trim() : `HR (${l.hr_by_name ?? 'HR'})`;
  const decision = (step === 'tl' ? l.tl_status : l.hr_status) === 'approved' ? 'approved' : 'declined';
  const note = step === 'tl' ? l.tl_note : l.hr_note;
  const link = nextIsHr ? `${origin}/leaves` : `${origin}/portal/approvals`;
  const body = `<p><b>Hello${nextIsTl && p.lead?.name ? ` ${escapeHtml(p.lead.name)}` : ''},</b></p>
<p>${escapeHtml(who)} has <b>${decision}</b> ${escapeHtml(p.e.name)}'s leave request. It is now waiting for ${nextIsHr ? 'HR' : 'you'}.</p>
${table([
    ['Employee', `${p.e.name} (${p.e.emp_code})`], ['Leave type', leaveLabel(l.leave_type)], ['Date(s)', when(l)], ['Working days', String(l.days)],
    ['Reason', l.reason?.trim() || '—'], ...(note ? [['Note', note] as [string, string]] : []),
  ])}
<p><a href="${escapeHtml(link)}" style="color:#2f6bff">Review it in the HR Portal</a></p>`;
  await send(p.s, nextIsHr ? [hrAddress(p.s)] : [p.lead?.email], `Leave waiting for ${nextIsHr ? 'HR' : 'you'}: ${p.e.name} — ${when(l)}`, body, p.e.email);
}

/** The employee cancelled a pending request: the team leader and HR do not need to act any more. */
export async function emailLeaveCancelled(l: LeaveRequest): Promise<void> {
  if (!mailConfigured()) return;
  const p = await parties(l);
  if (!p) return;
  const body = `<p><b>Hello,</b></p><p>${escapeHtml(p.e.name)} has <b>cancelled</b> this leave request — no action needed.</p>
${table([['Employee', `${p.e.name} (${p.e.emp_code})`], ['Leave type', leaveLabel(l.leave_type)], ['Date(s)', when(l)]])}`;
  await send(p.s, [p.lead?.email, hrAddress(p.s)], `Leave cancelled: ${p.e.name} — ${when(l)}`, body, p.e.email);
}
