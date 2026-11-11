import { NextResponse } from 'next/server';
import { mobileSession, mobileTeam } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { shiftMonth } from '@/lib/dates';
import { todayIST } from '@/lib/geo';
import type { LeaveRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Team leaders: their team's leave (pending + last 3 months). Approve / decline use PATCH /api/leave with as: 'tl'. */
export async function GET() {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  if (!r.s.isLead) return NextResponse.json({ error: 'Only team leaders can see team leave.' }, { status: 403 });
  const team = await mobileTeam(r.s);
  if (!team.length) return NextResponse.json({ leaves: [] });
  const by = new Map(team.map(t => [t.id, t]));
  const since = shiftMonth(`${todayIST().slice(0, 7)}-01`, -3);
  const { data, error } = await supabaseAdmin().from('leave_requests').select('*').in('employee_id', team.map(t => t.id))
    .or(`status.eq.pending,end_date.gte.${since}`).order('start_date', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    leaves: ((data ?? []) as LeaveRequest[]).map(l => ({ ...l, name: by.get(l.employee_id)?.name ?? '', emp_code: by.get(l.employee_id)?.emp_code ?? '' })),
  });
}
