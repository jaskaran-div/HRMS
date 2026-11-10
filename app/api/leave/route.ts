import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { teamIds } from '@/lib/portal';
import { overallStatus, validateLeave, type LeaveInput } from '@/lib/leave';
import { emailLeaveDecision, emailLeaveRequest } from '@/lib/leave-mail';
import { todayISO } from '@/lib/dates';
import type { LeaveRequest, Profile, Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

const log = (by: Profile, op: string, rowId: string, data: object) =>
  supabaseAdmin().from('audit_log').insert({ user_id: by.id, username: by.username, table_name: 'leave_requests', op, row_id: rowId, new_data: data });

/** Does the employee's team leader have an active team leader login (so their approval step applies)? */
async function hasLeadStep(employeeId: string): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data: emp } = await admin.from('employees').select('team_lead_id').eq('id', employeeId).maybeSingle();
  if (!emp?.team_lead_id) return false;
  const { data: p } = await admin.from('profiles').select('id').eq('employee_id', emp.team_lead_id).eq('role', 'team_lead').eq('active', true).maybeSingle();
  return !!p;
}

/** Apply for leave (for yourself). Body: { leave_type, start_date, end_date, reason, email } */
export async function POST(req: Request) {
  const g = await guard();
  if (!g.ok) return g.response;
  const empId = g.profile.employee_id;
  if (!empId) return NextResponse.json({ error: 'Your login is not linked to an employee record. Ask HR to link it.' }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as Partial<LeaveInput> & { email?: boolean };
  const input: LeaveInput = {
    leave_type: b.leave_type as LeaveInput['leave_type'], start_date: String(b.start_date ?? ''),
    end_date: String(b.end_date ?? b.start_date ?? ''), reason: String(b.reason ?? '').trim().slice(0, 1000),
  };
  if (input.leave_type === 'short') input.end_date = input.start_date;

  const admin = supabaseAdmin();
  const [{ data: settings }, { data: existing, error: exErr }, { data: emp }, leadStep] = await Promise.all([
    admin.from('settings').select('*').eq('id', 1).single(),
    admin.from('leave_requests').select('id, leave_type, start_date, end_date, days, status').eq('employee_id', empId)
      .gte('end_date', `${Number(input.start_date.slice(0, 4) || 2000) - 1}-01-01`),
    admin.from('employees').select('id, archived_at').eq('id', empId).maybeSingle(),
    hasLeadStep(empId),
  ]);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!emp || emp.archived_at) return NextResponse.json({ error: 'Your employee record is inactive.' }, { status: 403 });
  const v = validateLeave(input, (existing ?? []) as LeaveRequest[], settings as Settings, todayISO());
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const { data: row, error } = await admin.from('leave_requests').insert({
    employee_id: empId, leave_type: input.leave_type, start_date: input.start_date, end_date: input.end_date,
    days: v.days, reason: input.reason || null, created_by: g.user.id, requested_type: input.leave_type, over_quota: v.overQuota,
    tl_status: leadStep ? 'pending' : 'not_required', hr_status: 'pending', status: 'pending',
  }).select('*').single();
  if (error || !row) return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
  await log(g.profile, 'APPLY_LEAVE', row.id, { type: input.leave_type, from: input.start_date, to: input.end_date, days: v.days, over_quota: v.overQuota });

  let mail: { ok: boolean; to?: string[]; error?: string } | null = null;
  if (b.email !== false) mail = await emailLeaveRequest(row as LeaveRequest, new URL(req.url).origin);
  return NextResponse.json({ leave: row, mail });
}

/**
 * Body: { id, action: 'approve' | 'reject' | 'cancel' | 'email', note?, as?: 'hr' | 'tl', count_as?: 'paid' | 'unpaid' }
 * count_as (HR approving a paid / absent request): what the leave counts as in attendance — paid leave or absent.
 * approve / reject decide ONE step: HR's (admin / editor) or the team leader's (a team leader above the employee).
 *   The overall status follows from both steps. `as` picks the step when someone could do both.
 * cancel / email: the employee, for their own pending request.
 */
export async function PATCH(req: Request) {
  const g = await guard();
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { id?: string; action?: string; note?: string; as?: 'hr' | 'tl'; count_as?: 'paid' | 'unpaid' };
  if (!b.id) return NextResponse.json({ error: 'Missing request.' }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: found } = await admin.from('leave_requests').select('*').eq('id', b.id).maybeSingle();
  if (!found) return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 });
  const l = found as LeaveRequest;
  const own = !!g.profile.employee_id && g.profile.employee_id === l.employee_id;

  if (b.action === 'cancel' || b.action === 'email') {
    if (!own) return NextResponse.json({ error: 'Only the employee can do this.' }, { status: 403 });
    if (l.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be changed.' }, { status: 400 });
    if (b.action === 'email') {
      const mail = await emailLeaveRequest(l, new URL(req.url).origin);
      return mail.ok ? NextResponse.json({ ok: true, to: mail.to }) : NextResponse.json({ error: mail.error }, { status: 502 });
    }
    await admin.from('leave_requests').update({ status: 'cancelled' }).eq('id', l.id);
    await log(g.profile, 'CANCEL_LEAVE', l.id, {});
    return NextResponse.json({ ok: true });
  }

  if (b.action !== 'approve' && b.action !== 'reject') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (own) return NextResponse.json({ error: 'You cannot decide your own leave.' }, { status: 403 });
  if (l.status === 'cancelled') return NextResponse.json({ error: 'The employee cancelled this request.' }, { status: 400 });

  const canHr = g.profile.role === 'admin' || g.profile.role === 'editor';
  const canTl = g.profile.role === 'team_lead' && !!g.profile.employee_id && (await teamIds(g.profile.employee_id)).includes(l.employee_id);
  const step: 'hr' | 'tl' | null = b.as === 'tl' ? (canTl ? 'tl' : null) : b.as === 'hr' ? (canHr ? 'hr' : null) : canHr ? 'hr' : canTl ? 'tl' : null;
  if (!step) return NextResponse.json({ error: 'You cannot decide this request.' }, { status: 403 });

  const decision = b.action === 'approve' ? 'approved' : 'rejected';
  // HR may approve a paid-leave request as absent (or an absent request as paid leave); short leave stays short leave
  const countAs = step === 'hr' && decision === 'approved' && l.leave_type !== 'short' && (b.count_as === 'paid' || b.count_as === 'unpaid') ? b.count_as : null;
  const note = (b.note ?? '').trim().slice(0, 500) || null;
  const now = new Date().toISOString();
  const tl = step === 'tl' ? decision : l.tl_status;
  const hr = step === 'hr' ? decision : l.hr_status;
  const status = overallStatus(tl, hr);
  const { data: updated, error } = await admin.from('leave_requests').update({
    ...(step === 'tl'
      ? { tl_status: decision, tl_by: g.user.id, tl_by_name: g.profile.full_name, tl_at: now, tl_note: note }
      : { hr_status: decision, hr_by: g.user.id, hr_by_name: g.profile.full_name, hr_at: now, hr_note: note }),
    ...(countAs ? { leave_type: countAs, requested_type: l.requested_type ?? l.leave_type } : {}),
    status, decided_by: g.user.id, decided_by_name: g.profile.full_name, decided_at: now, decision_note: note,
  }).eq('id', l.id).select('*').single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
  await log(g.profile, `${step.toUpperCase()}_${decision === 'approved' ? 'APPROVE' : 'REJECT'}_LEAVE`, l.id, { employee_id: l.employee_id, status, ...(countAs ? { counted_as: countAs } : {}) });
  // the employee hears about it once the overall outcome is known (or changes)
  if (status !== l.status && status !== 'pending') await emailLeaveDecision(updated as LeaveRequest);
  return NextResponse.json({ ok: true, leave: updated, step });
}
