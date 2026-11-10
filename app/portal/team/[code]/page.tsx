import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { myTeam, portalSession } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { currentYM, fmtDate, monthLabel, shiftMonth, todayISO } from '@/lib/dates';
import { monthParam, type ViewLeave } from '@/lib/att-view';
import { MonthPicker } from '@/components/portal/MonthPicker';
import { AttendanceCalendar, AttendanceLegend } from '@/components/portal/AttendanceViews';
import { initials } from '@/lib/format';
import { PayslipTable } from '@/components/portal/PayslipTable';
import { AttendanceTable, ATTENDANCE_COLUMNS, type AttendanceSummary } from '@/components/portal/AttendanceTable';
import { TeamLeaves } from '@/components/portal/TeamLeaves';
import type { LeaveRequest, PayslipData } from '@/lib/types';

export const dynamic = 'force-dynamic';

const kv = (label: string, value: string | null | undefined) =>
  value ? <div className="kv"><small>{label}</small><span>{value}</span></div> : null;

export default async function TeamMemberPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ month?: string }> }) {
  const s = await portalSession();
  if (!s.isLead) redirect('/portal');
  const code = decodeURIComponent((await params).code).toUpperCase();
  const team = await myTeam(s);
  // only people in this leader's own team can be opened
  const m = team.find(t => t.emp_code === code);
  if (!m) notFound();
  const admin = supabaseAdmin();
  const [att, slips, leaves] = await Promise.all([
    admin.from('attendance').select(ATTENDANCE_COLUMNS).eq('employee_id', m.id).order('month', { ascending: false }).limit(12),
    admin.from('payslips').select('data').eq('employee_id', m.id).order('month', { ascending: false }),
    admin.from('leave_requests').select('*').eq('employee_id', m.id).order('start_date', { ascending: false }).limit(30),
  ]);
  const lead = team.find(t => t.id === m.team_lead_id);
  // the calendar: chosen month, else the latest month HR marked
  const ym = monthParam((await searchParams).month) ?? ((att.data ?? [])[0]?.month as string | undefined)?.slice(0, 7) ?? currentYM();
  const month = `${ym}-01`;
  const { data: day } = await admin.from('attendance').select('daily').eq('employee_id', m.id).eq('month', month).maybeSingle();
  const monthLeaves = ((leaves.data ?? []) as LeaveRequest[]).filter(l => l.status === 'approved' && l.start_date < shiftMonth(month, 1) && l.end_date >= month) as ViewLeave[];

  return (
    <>
      <div className="page-h"><Link href="/portal/team" className="btn">← My team</Link></div>
      <div className="card">
        <div className="hero">
          <div className="av">{initials(m.name)}</div>
          <div>
            <h2>{m.name}</h2>
            <div className="chips">
              <span className="pill gray">{m.emp_code}</span>
              {m.designation && <span className="pill gray">{m.designation}</span>}
              {m.department && <span className="pill gray">{m.department}</span>}
            </div>
          </div>
        </div>
        <div className="grid" style={{ marginTop: 16 }}>
          {kv('Email', m.email)}{kv('Phone', m.phone)}{kv('Date of joining', fmtDate(m.doj))}{kv('Location', m.location)}
          {kv('Reports to', m.team_lead_id === s.me!.id ? 'You' : lead?.name)}
        </div>
      </div>
      <div className="card"><h3>Leave</h3>
        <TeamLeaves showName={false} rows={((leaves.data ?? []) as LeaveRequest[]).map(l => ({ ...l, name: m.name, emp_code: m.emp_code }))} />
      </div>
      <div className="card">
        <div className="card-h"><h3>Attendance · {monthLabel(month)}</h3><span className="sp" /><MonthPicker ym={ym} max={currentYM()} /></div>
        {!day && <div className="note" style={{ marginBottom: 12 }}>HR has not marked {monthLabel(month)} yet.</div>}
        <AttendanceCalendar month={month} daily={day?.daily as Record<string, string> | null} doj={m.doj} leaves={monthLeaves} today={todayISO()} />
        <AttendanceLegend />
        <h3 style={{ marginTop: 22 }}>Month by month</h3>
        <AttendanceTable rows={(att.data ?? []) as AttendanceSummary[]} link={mm => `/portal/team/${encodeURIComponent(m.emp_code)}?month=${mm.slice(0, 7)}`} />
      </div>
      <div className="card"><h3>Payslips</h3><PayslipTable slips={(slips.data ?? []).map(r => r.data as PayslipData)} /></div>
    </>
  );
}
