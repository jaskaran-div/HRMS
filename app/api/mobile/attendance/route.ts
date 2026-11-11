import { NextResponse } from 'next/server';
import { mobileSession, ymParam } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { shiftMonth } from '@/lib/dates';
import { todayIST } from '@/lib/geo';

export const dynamic = 'force-dynamic';

/** GET ?month=YYYY-MM — day-by-day attendance, approved leave and check-in times for one month (default: this month). */
export async function GET(req: Request) {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  const me = r.s.me;
  const ym = ymParam(new URL(req.url).searchParams.get('month')) ?? todayIST().slice(0, 7);
  const month = `${ym}-01`;
  const next = shiftMonth(month, 1);
  const admin = supabaseAdmin();
  const [{ data: att }, { data: leaves }, { data: punches }] = await Promise.all([
    admin.from('attendance').select('daily, present_days, absent_days, half_days, leave_days, short_leave_days, weekoff_days, holiday_days')
      .eq('employee_id', me.id).eq('month', month).maybeSingle(),
    admin.from('leave_requests').select('leave_type, start_date, end_date').eq('employee_id', me.id)
      .eq('status', 'approved').lt('start_date', next).gte('end_date', month),
    admin.from('attendance_punches').select('day, in_at, out_at').eq('employee_id', me.id).gte('day', month).lt('day', next),
  ]);
  return NextResponse.json({
    month, doj: me.doj, today: todayIST(),
    attendance: att ?? null, leaves: leaves ?? [], punches: punches ?? [],
  });
}
