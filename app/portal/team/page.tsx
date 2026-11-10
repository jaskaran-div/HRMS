import Link from 'next/link';
import { redirect } from 'next/navigation';
import { myTeam, portalSession } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fmtDate, todayISO } from '@/lib/dates';
import { initials } from '@/lib/format';
import { leaveLabel } from '@/lib/leave';

export const dynamic = 'force-dynamic';

export default async function MyTeamPage() {
  const s = await portalSession();
  if (!s.isLead) redirect('/portal');
  const team = await myTeam(s);
  const today = todayISO();
  const { data: onLeave } = team.length
    ? await supabaseAdmin().from('leave_requests').select('employee_id, leave_type').in('employee_id', team.map(t => t.id))
      .eq('status', 'approved').lte('start_date', today).gte('end_date', today)
    : { data: [] };
  const away = new Map((onLeave ?? []).map(l => [l.employee_id as string, l.leave_type as Parameters<typeof leaveLabel>[0]]));
  const by = new Map(team.map(t => [t.id, t]));
  const direct = team.filter(t => t.team_lead_id === s.me!.id).length;

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>My team</h3>
        <span className="muted small">{team.length} people · {direct} report to you directly</span>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Department</th><th>Designation</th><th>Reports to</th><th>Joined</th><th>Today</th></tr></thead>
          <tbody>
            {team.map(t => (
              <tr key={t.id}>
                <td><Link href={`/portal/team/${encodeURIComponent(t.emp_code)}`} className="who-c"><div className="av">{initials(t.name)}</div><b>{t.name}</b></Link><div className="muted small">{t.emp_code}</div></td>
                <td>{t.department}</td><td>{t.designation}</td>
                <td>{t.team_lead_id === s.me!.id ? 'You' : by.get(t.team_lead_id ?? '')?.name ?? '—'}</td>
                <td>{fmtDate(t.doj)}</td>
                <td>{away.has(t.id) ? <span className="pill warn">{leaveLabel(away.get(t.id)!)}</span> : <span className="pill ok">Working</span>}</td>
              </tr>
            ))}
            {!team.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 26 }}>Nobody is in your team yet. HR sets this under Teams &amp; hierarchy.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
