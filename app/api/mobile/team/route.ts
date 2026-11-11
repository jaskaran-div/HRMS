import { NextResponse } from 'next/server';
import { mobileSession, mobileTeam, ymParam } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { shiftMonth } from '@/lib/dates';
import { todayIST } from '@/lib/geo';

export const dynamic = 'force-dynamic';

/**
 * Team leaders: everyone below them, with one month of attendance (day by day), approved leave and app check-ins.
 * Same columns as the web portal's team view: no bank, PAN or salary.
 */
export async function GET(req: Request) {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  if (!r.s.isLead) return NextResponse.json({ error: 'Only team leaders can see a team.' }, { status: 403 });
  const today = todayIST();
  const ym = ymParam(new URL(req.url).searchParams.get('month')) ?? today.slice(0, 7);
  const month = `${ym}-01`;
  const next = shiftMonth(month, 1);
  const team = await mobileTeam(r.s);
  if (!team.length) return NextResponse.json({ month, today, members: [] });
  const ids = team.map(t => t.id);
  const admin = supabaseAdmin();
  const [{ data: att }, { data: leaves }, { data: punches }] = await Promise.all([
    admin.from('attendance').select('employee_id, daily').eq('month', month).in('employee_id', ids),
    admin.from('leave_requests').select('employee_id, leave_type, start_date, end_date').in('employee_id', ids)
      .eq('status', 'approved').lt('start_date', next).gte('end_date', month),
    admin.from('attendance_punches').select('employee_id, day, in_at, out_at').in('employee_id', ids)
      .or(`and(day.gte.${month},day.lt.${next}),day.eq.${today}`),
  ]);
  const dailyBy = new Map((att ?? []).map(a => [a.employee_id as string, a.daily as Record<string, string> | null]));
  return NextResponse.json({
    month, today,
    members: team.map(t => ({
      id: t.id, emp_code: t.emp_code, name: t.name, department: t.department, designation: t.designation,
      email: t.email, phone: t.phone, doj: t.doj,
      daily: dailyBy.get(t.id) ?? null,
      leaves: (leaves ?? []).filter(l => l.employee_id === t.id),
      punches: (punches ?? []).filter(p => p.employee_id === t.id).map(p => ({ day: p.day, in_at: p.in_at, out_at: p.out_at })),
    })),
  });
}
