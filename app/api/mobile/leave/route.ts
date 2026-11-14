import { NextResponse } from 'next/server';
import { mobileSession } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { shiftMonth } from '@/lib/dates';
import { todayIST } from '@/lib/geo';

export const dynamic = 'force-dynamic';

/** The employee's leave for the last 12 months (and ahead) + the monthly allowances. Apply / cancel use /api/leave. */
export async function GET() {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  const today = todayIST();
  const since = shiftMonth(`${today.slice(0, 7)}-01`, -12);
  const admin = supabaseAdmin();
  const [{ data, error }, { data: marked }] = await Promise.all([
    admin.from('leave_requests').select('*').eq('employee_id', r.s.me.id).gte('end_date', since).order('start_date', { ascending: false }),
    // short / paid leave HR marked in the attendance calendar (counts toward the monthly allowance)
    admin.from('attendance').select('month, daily, short_leave_days, leave_days').eq('employee_id', r.s.me.id).gte('month', since),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    today, leaves: data ?? [], marked: marked ?? [],
    rules: { short_leave_per_month: r.s.settings.short_leave_per_month, paid_leave_per_month: r.s.settings.paid_leave_per_month },
  });
}
