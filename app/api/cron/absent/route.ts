import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { markDay } from '@/lib/attendance-mark';
import { minutesIST, windows } from '@/lib/late';
import { todayIST } from '@/lib/geo';
import { isWeekOff } from '@/lib/leave';
import { leavingDate } from '@/lib/exit';
import { orgHasAccess, type Org } from '@/lib/org';
import type { Employee, Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Run every few minutes (crontab on the server). For each organization with an office timing rule, once the
 * second-half check-in window has closed (second half start + allowance, IST), marks today Absent for every active
 * employee who has not checked in — skipping week offs, days HR already marked (e.g. a holiday), and approved
 * full-day leave. Safe to run again: marked days are never changed.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const day = todayIST();
  if (isWeekOff(day)) return NextResponse.json({ day, skipped: 'week off' });
  const now = minutesIST();
  const admin = supabaseAdmin();
  const { data: all, error } = await admin.from('settings').select('*').not('office_start_time', 'is', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result: Record<string, number> = {};
  for (const st of (all ?? []) as Settings[]) {
    const w = windows(st);
    if (!w || now <= w.deadline) continue;
    const { data: org } = await admin.from('organizations').select('*').eq('id', st.org_id).maybeSingle();
    if (!org || !orgHasAccess(org as Org)) continue;

    const [{ data: emps }, { data: punches }, { data: leaves }] = await Promise.all([
      admin.from('employees').select('id, doj, monthly_salary, archived_at, extra').eq('org_id', st.org_id).is('archived_at', null),
      admin.from('attendance_punches').select('employee_id').eq('day', day),
      // approved full-day leave today: HR fills those in from the grid, never marked absent here
      admin.from('leave_requests').select('employee_id').eq('org_id', st.org_id).eq('status', 'approved')
        .in('leave_type', ['paid', 'unpaid']).lte('start_date', day).gte('end_date', day),
    ]);
    const skip = new Set([...(punches ?? []), ...(leaves ?? [])].map(x => x.employee_id as string));
    // already marked today (or the month entered as totals only): nothing to do
    const ids = (emps ?? []).map(e => e.id as string);
    for (let i = 0; i < ids.length; i += 200) {
      const { data: att } = await admin.from('attendance').select('employee_id, daily').eq('month', `${day.slice(0, 7)}-01`).in('employee_id', ids.slice(i, i + 200));
      for (const a of att ?? []) {
        const daily = a.daily as Record<string, string> | null;
        if (!daily || daily[String(Number(day.slice(8, 10)))]) skip.add(a.employee_id as string);
      }
    }
    let marked = 0;
    for (const e of (emps ?? []) as Pick<Employee, 'id' | 'doj' | 'monthly_salary' | 'archived_at' | 'extra'>[]) {
      if (skip.has(e.id) || (e.doj && e.doj > day)) continue;
      const left = leavingDate(e as Employee);
      if (left && left < day) continue;
      if (await markDay(e.id, e.doj, Number(e.monthly_salary), day, 'A')) marked++;
    }
    result[st.org_id] = marked;
  }
  return NextResponse.json({ day, marked: result });
}
