import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { downgradeToHalf, markDay } from '@/lib/attendance-mark';
import { minutesIST, windows } from '@/lib/late';
import { todayIST } from '@/lib/geo';
import { isWeekOff } from '@/lib/leave';
import { leavingDate } from '@/lib/exit';
import { orgHasAccess, type Org } from '@/lib/org';
import type { Employee, Punch, Settings, Shift } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Emp = Pick<Employee, 'id' | 'doj' | 'monthly_salary' | 'archived_at' | 'extra' | 'shift_id'>;

/** Runs the jobs with at most `size` in flight. */
async function runPool(jobs: (() => Promise<void>)[], size: number) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) await jobs[next++]();
  }));
}

/**
 * Run every 10 minutes (crontab on the server). For each organization with an office timing rule, per employee
 * (their shift's windows, else the company's):
 *  - once the second-half check-in window has closed: not checked in = Absent — skipping week offs, days HR already
 *    marked (e.g. a holiday) and approved full-day leave;
 *  - once the check-out deadline has passed: checked in but not checked out = the day becomes a Half day.
 * Safe to run again: days HR marked by hand are never changed.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const day = todayIST();
  const weekOff = isWeekOff(day);
  const now = minutesIST();
  const admin = supabaseAdmin();
  // every org: the company timing may be off while its shifts have their own (each employee is checked below).
  // Organizations and shifts of all orgs in one query each, not one query per organization.
  const [{ data: all, error }, { data: orgs, error: orgErr }, { data: allShifts, error: shiftErr }] = await Promise.all([
    admin.from('settings').select('*'),
    admin.from('organizations').select('id, status, billing_exempt'),
    admin.from('shifts').select('*'),
  ]);
  if (error || orgErr || shiftErr) return NextResponse.json({ error: (error ?? orgErr ?? shiftErr)!.message }, { status: 500 });
  const orgById = new Map(((orgs ?? []) as Pick<Org, 'id' | 'status' | 'billing_exempt'>[]).map(o => [o.id, o]));
  const shiftsByOrg = new Map<string, Shift[]>();
  for (const s of (allShifts ?? []) as (Shift & { org_id: string })[]) shiftsByOrg.set(s.org_id, [...(shiftsByOrg.get(s.org_id) ?? []), s]);

  const result: Record<string, { absent: number; no_checkout: number }> = {};
  let notDue = 0; // organizations skipped because no window has closed yet (counted, not listed: the log stays small)
  for (const st of (all ?? []) as Settings[]) {
    const org = orgById.get(st.org_id);
    if (!org || !orgHasAccess(org)) continue;
    const shifts = shiftsByOrg.get(st.org_id) ?? [];

    // Nothing can be due before a window closes: an employee is only ever marked once now is past their window's
    // deadline (absent) or check-out time (missed check-out), and each employee's window is the company's or one of
    // these shifts'. Skipping here (most of the day, every 10 minutes) avoids loading the whole organization.
    const due = [windows(st, null), ...shifts.map(s => windows(st, s))].some(w =>
      !!w && ((!weekOff && now > w.deadline) || (w.checkoutBy != null && now > w.checkoutBy)));
    if (!due) { notDue++; continue; }

    const [{ data: emps }, { data: leaves }] = await Promise.all([
      admin.from('employees').select('id, doj, monthly_salary, archived_at, extra, shift_id').eq('org_id', st.org_id).is('archived_at', null),
      // approved full-day leave today: HR fills those in from the grid, never marked absent here
      admin.from('leave_requests').select('employee_id').eq('org_id', st.org_id).eq('status', 'approved')
        .in('leave_type', ['paid', 'unpaid']).lte('start_date', day).gte('end_date', day),
    ]);
    const list = ((emps ?? []) as Emp[]).filter(e => {
      if (e.doj && e.doj > day) return false;
      const left = leavingDate(e as Employee);
      return !left || left >= day;
    });
    const shiftById = new Map(shifts.map(s => [s.id, s]));
    const ids = list.map(e => e.id);
    const punchBy = new Map<string, Punch>();
    const markedToday = new Set<string>(); // already marked (or the month entered as totals only)
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      const [{ data: ps }, { data: att }] = await Promise.all([
        admin.from('attendance_punches').select('*').eq('day', day).in('employee_id', part),
        admin.from('attendance').select('employee_id, daily').eq('month', `${day.slice(0, 7)}-01`).in('employee_id', part),
      ]);
      for (const p of (ps ?? []) as Punch[]) punchBy.set(p.employee_id, p);
      for (const a of att ?? []) {
        const daily = a.daily as Record<string, string> | null;
        if (!daily || daily[String(Number(day.slice(8, 10)))]) markedToday.add(a.employee_id as string);
      }
    }
    const onLeave = new Set((leaves ?? []).map(l => l.employee_id as string));

    let absent = 0, noCheckout = 0;
    const jobs: (() => Promise<void>)[] = [];
    for (const e of list) {
      const w = windows(st, e.shift_id ? shiftById.get(e.shift_id) : null);
      if (!w) continue;
      const p = punchBy.get(e.id);
      if (!p) {
        if (weekOff || onLeave.has(e.id) || markedToday.has(e.id) || now <= w.deadline) continue;
        jobs.push(async () => { if (await markDay(e.id, e.doj, Number(e.monthly_salary), day, 'A')) absent++; });
      } else if (!p.out_at && !p.out_missed && w.checkoutBy != null && now > w.checkoutBy) {
        jobs.push(async () => {
          await admin.from('attendance_punches').update({ out_missed: true }).eq('id', p.id);
          if (await downgradeToHalf(e.id, e.doj, Number(e.monthly_salary), day)) noCheckout++;
        });
      }
    }
    // each job touches one employee's rows only, so a few run at once (one at a time took minutes for a big org)
    await runPool(jobs, 8);
    result[st.org_id] = { absent, no_checkout: noCheckout };
  }
  return NextResponse.json({ day, result, not_due: notDue });
}
