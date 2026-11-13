import { NextResponse } from 'next/server';
import { mobileSession, mobileTeam } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { quotaFor } from '@/lib/leave';
import { todayIST } from '@/lib/geo';
import { orgFeatures } from '@/lib/org';
import type { LeaveRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Everything the app's home screen needs, in one call. */
export async function GET() {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  const { org, profile, settings: st, me, lead, isLead } = r.s;
  const features = orgFeatures(org);
  const admin = supabaseAdmin();
  const today = todayIST();
  const month = `${today.slice(0, 7)}-01`;

  const [{ data: leaves }, { data: slip }, { data: att }, { data: punch }, { count: unread }, team] = await Promise.all([
    admin.from('leave_requests').select('id, leave_type, start_date, days, status').eq('employee_id', me.id).gte('end_date', month),
    features.includes('payroll')
      ? admin.from('payslips').select('month, net_pay').eq('employee_id', me.id).order('month', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('attendance').select('month, present_days').eq('employee_id', me.id).eq('month', month).maybeSingle(),
    admin.from('attendance_punches').select('*').eq('employee_id', me.id).eq('day', today).maybeSingle(),
    admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).is('read_at', null),
    mobileTeam(r.s),
  ]);
  let pendingTeam = 0;
  if (team.length) {
    const { count } = await admin.from('leave_requests').select('id', { count: 'exact', head: true })
      .in('employee_id', team.map(t => t.id)).eq('status', 'pending').eq('tl_status', 'pending');
    pendingTeam = count ?? 0;
  }
  const q = quotaFor((leaves ?? []) as LeaveRequest[], month, st);

  return NextResponse.json({
    profile: { id: profile.id, username: profile.username, full_name: profile.full_name, role: profile.role, must_change_password: profile.must_change_password },
    me, lead: lead ? { name: lead.name, email: lead.email, phone: lead.phone } : null, isLead,
    company: { name: st.company_name, logo: st.logo },
    organization: { id: org.id, name: org.name, status: org.status, features },
    office: st.office_lat != null && st.office_lng != null ? { lat: st.office_lat, lng: st.office_lng, radius_m: st.office_radius_m ?? 100 } : null,
    today, punch: punch ?? null,
    quota: q,
    presentThisMonth: att ? Number(att.present_days) : 0,
    latestSlip: slip ? { month: slip.month, net_pay: Number(slip.net_pay) } : null,
    unread: unread ?? 0, pendingTeam, teamSize: team.length,
  });
}
