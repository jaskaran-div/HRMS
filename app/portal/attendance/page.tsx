import Link from 'next/link';
import { myTeam, portalSession } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { currentYM, monthLabel, shiftMonth, todayISO } from '@/lib/dates';
import { monthParam, type ViewLeave } from '@/lib/att-view';
import { MonthPicker } from '@/components/portal/MonthPicker';
import { AttendanceCalendar, AttendanceLegend, TeamAttendanceGrid, type GridPerson } from '@/components/portal/AttendanceViews';
import { AttendanceTable, ATTENDANCE_COLUMNS, type AttendanceSummary } from '@/components/portal/AttendanceTable';

export const dynamic = 'force-dynamic';

type Row = { employee_id: string; daily: Record<string, string> | null };
type Lv = ViewLeave & { employee_id: string };

export default async function MyAttendance({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const s = await portalSession();
  const me = s.me!;
  const sp = await searchParams;
  const admin = supabaseAdmin();
  const nowYM = currentYM();

  // no month chosen: open the latest month HR has marked (attendance is usually entered after the month ends)
  let ym = monthParam(sp.month);
  if (!ym) {
    const { data } = await admin.from('attendance').select('month').eq('employee_id', me.id).order('month', { ascending: false }).limit(1).maybeSingle();
    ym = (data?.month as string | undefined)?.slice(0, 7) ?? nowYM;
  }
  const month = `${ym}-01`;
  const next = shiftMonth(month, 1);
  const teamView = s.isLead && sp.view === 'team';
  const team = teamView ? await myTeam(s) : [];
  const ids = [me.id, ...team.map(t => t.id)];

  const [{ data: att }, { data: lv }, { data: history }] = await Promise.all([
    admin.from('attendance').select('employee_id, daily').eq('month', month).in('employee_id', ids),
    admin.from('leave_requests').select('employee_id, leave_type, start_date, end_date').in('employee_id', ids)
      .eq('status', 'approved').lt('start_date', next).gte('end_date', month),
    teamView ? Promise.resolve({ data: [] }) : admin.from('attendance').select(ATTENDANCE_COLUMNS).eq('employee_id', me.id).order('month', { ascending: false }).limit(24),
  ]);
  const dailyBy = new Map(((att ?? []) as Row[]).map(r => [r.employee_id, r.daily]));
  const leavesOf = (id: string) => ((lv ?? []) as Lv[]).filter(l => l.employee_id === id);
  const marked = dailyBy.has(me.id);

  const tabs = s.isLead && (
    <div className="seg">
      <Link href={`/portal/attendance?month=${ym}`} className={!teamView ? 'on' : ''}>My calendar</Link>
      <Link href={`/portal/attendance?month=${ym}&view=team`} className={teamView ? 'on' : ''}>My team</Link>
    </div>
  );

  return (
    <>
      <div className="page-h">
        <MonthPicker ym={ym} max={nowYM} />
        {tabs}
        <span className="sp" />
        <span className="muted small">{monthLabel(month)}</span>
      </div>

      {teamView ? (
        <div className="card">
          <div className="card-h"><h3>Team attendance · {monthLabel(month)}</h3><span className="sp" /><span className="muted small">{team.length} in your team</span></div>
          <AttendanceLegend />
          <TeamAttendanceGrid month={month} people={[
            { id: me.id, name: me.name, emp_code: me.emp_code, doj: me.doj, you: true, daily: dailyBy.get(me.id) ?? null, leaves: leavesOf(me.id) },
            ...team.map<GridPerson>(t => ({
              id: t.id, name: t.name, emp_code: t.emp_code, doj: t.doj, daily: dailyBy.get(t.id) ?? null, leaves: leavesOf(t.id),
              href: `/portal/team/${encodeURIComponent(t.emp_code)}?month=${ym}`,
            })),
          ]} />
          <p className="muted small" style={{ marginBottom: 0 }}>View only — HR marks attendance. Click a name to open that person. Empty cells are days HR has not marked yet.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-h"><h3>My attendance · {monthLabel(month)}</h3></div>
            {!marked && <div className="note" style={{ marginBottom: 12 }}>HR has not marked attendance for {monthLabel(month)} yet{leavesOf(me.id).length ? ' — your approved leave is shown already' : ''}.</div>}
            <AttendanceCalendar month={month} daily={dailyBy.get(me.id)} doj={me.doj} leaves={leavesOf(me.id)} today={todayISO()} />
            <AttendanceLegend />
          </div>
          <div className="card">
            <h3>Month by month</h3>
            <AttendanceTable rows={(history ?? []) as AttendanceSummary[]} link={m => `/portal/attendance?month=${m.slice(0, 7)}`} />
          </div>
        </>
      )}
    </>
  );
}
