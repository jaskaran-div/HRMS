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
  const { data: all, error } = await admin.from('settings').select('*').not('office_start_time', 'is', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result: Record<string, { absent: number; no_checkout: number }> = {};
  for (const st of (all ?? []) as Settings[]) {
    if (!windows(st)) continue;
    const { data: org } = await admin.from('organizations').select('*').eq('id', st.org_id).maybeSingle();
    if (!org || !orgHasAccess(org as Org)) continue;

    const [{ data: emps }, { data: shifts }, { data: leaves }] = await Promise.all([
      admin.from('employees').select('id, doj, monthly_salary, archived_at, extra, shift_id').eq('org_id', st.org_id).is('archived_at', null),
      admin.from('shifts').select('*').eq('org_id', st.org_id),
      // approved full-day leave today: HR fills those in from the grid, never marked absent here
      admin.from('leave_requests').select('employee_id').eq('org_id', st.org_id).eq('status', 'approved')
        .in('leave_type', ['paid', 'unpaid']).lte('start_date', day).gte('end_date', day),
    ]);
    const list = ((emps ?? []) as Emp[]).filter(e => {
      if (e.doj && e.doj > day) return false;
      const left = leavingDate(e as Employee);
      return !left || left >= day;
    });
    const shiftById = new Map(((shifts ?? []) as Shift[]).map(s => [s.id, s]));
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
    for (const e of list) {
      const w = windows(st, e.shift_id ? shiftById.get(e.shift_id) : null);
      if (!w) continue;
      const p = punchBy.get(e.id);
      if (!p) {
        if (weekOff || onLeave.has(e.id) || markedToday.has(e.id) || now <= w.deadline) continue;
        if (await markDay(e.id, e.doj, Number(e.monthly_salary), day, 'A')) absent++;
      } else if (!p.out_at && !p.out_missed && w.checkoutBy != null && now > w.checkoutBy) {
        await admin.from('attendance_punches').update({ out_missed: true }).eq('id', p.id);
        if (await downgradeToHalf(e.id, e.doj, Number(e.monthly_salary), day)) noCheckout++;
      }
    }
    result[st.org_id] = { absent, no_checkout: noCheckout };
  }
  return NextResponse.json({ day, result });
}
