'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { Icon } from '@/components/Icon';
import { ErrorBox, Skeleton } from '@/components/ui';
import { AttendanceStrip, StripLegend, type StripMark } from '@/components/AttendanceStrip';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { payFor, rulesFrom } from '@/lib/payroll';
import { fmtDate, monthLabel, todayISO } from '@/lib/dates';
import { initials, inrWhole } from '@/lib/format';
import { leaveLabel } from '@/lib/leave';
import type { Attendance, Employee, LeaveRequest } from '@/lib/types';

type Leave = LeaveRequest & { employees: { name: string; emp_code: string } | null };

export default function Dashboard() {
  const { settings, profile, canEdit } = useApp();
  const rules = rulesFrom(settings);
  const today = todayISO();

  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [emps, latest, waiting, away] = await Promise.all([
      fetchAll<Employee>((a, b) => sb.from('employees').select('*').is('archived_at', null).order('emp_code').range(a, b)),
      sb.from('attendance').select('month').order('month', { ascending: false }).limit(1),
      sb.from('leave_requests').select('*, employees(name, emp_code)').eq('status', 'pending').eq('hr_status', 'pending').order('start_date').limit(6),
      sb.from('leave_requests').select('*, employees(name, emp_code)').eq('status', 'approved').lte('start_date', today).gte('end_date', today),
    ]);
    const month: string | null = latest.data?.[0]?.month ?? null;
    const att = month ? await fetchAll<Attendance>((a, b) => sb.from('attendance').select('*').eq('month', month).range(a, b)) : [];
    const { count } = month ? await sb.from('payslips').select('id', { count: 'exact', head: true }).eq('month', month) : { count: 0 };
    const { count: waitingCount } = await sb.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('hr_status', 'pending');
    return {
      emps, month, att, slips: count ?? 0, waiting: (waiting.data ?? []) as Leave[], waitingCount: waitingCount ?? 0,
      away: (away.data ?? []) as Leave[],
    };
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const attBy = new Map(data.att.map(a => [a.employee_id, a]));
    let net = 0;
    for (const e of data.emps) { const a = attBy.get(e.id); if (a) net += payFor(e, a, rules).net; }
    const depts = new Map<string, number>();
    data.emps.forEach(e => depts.set(e.department || 'Unassigned', (depts.get(e.department || 'Unassigned') ?? 0) + 1));

    // company attendance per day: share of marked people who were paid-present (present, paid / short leave, ½ for half day)
    const marks: Record<number, StripMark> = {};
    const titles: Record<number, string> = {};
    if (data.month) {
      const per = new Map<number, Record<string, number>>();
      for (const a of data.att) for (const [d, c] of Object.entries(a.daily ?? {})) {
        const r = per.get(+d) ?? {}; r[c] = (r[c] ?? 0) + 1; per.set(+d, r);
      }
      for (const [d, r] of per) {
        const worked = (r.P ?? 0) + (r.L ?? 0) + (r.S ?? 0) + (r.H ?? 0) * 0.5;
        const marked = (r.P ?? 0) + (r.L ?? 0) + (r.S ?? 0) + (r.H ?? 0) + (r.A ?? 0);
        if (!marked) { marks[d] = (r.O ?? 0) > (r.W ?? 0) ? 'o' : 'w'; titles[d] = (r.O ?? 0) > (r.W ?? 0) ? 'Holiday' : 'Week off'; continue; }
        const ratio = worked / marked;
        marks[d] = ratio >= 0.9 ? 'p' : ratio >= 0.7 ? 'mid' : 'low';
        titles[d] = `${r.P ?? 0} present · ${r.A ?? 0} absent · ${r.H ?? 0} half day · ${(r.L ?? 0) + (r.S ?? 0)} on leave`;
      }
    }
    return { net, marks, titles, depts: [...depts].sort((a, b) => b[1] - a[1]), missing: data.emps.filter(e => !attBy.has(e.id)).length };
  }, [data, rules]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !stats) return loading ? <Skeleton cards={4} rows={6} /> : null;

  const max = stats.depts[0]?.[1] ?? 1;
  const when = (l: LeaveRequest) => (l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`);

  return (
    <>
      <div className="page-h">
        <div className="pagehead" style={{ margin: 0 }}>
          <h1>Human Resource</h1>
          <p>Welcome back, {profile.full_name.split(' ')[0]} — here is {settings.company_name} today.</p>
        </div>
        <span className="sp" />
        <button className="icon-btn" onClick={reload} aria-label="Refresh" title="Refresh"><Icon name="refresh" size={16} /></button>
        {canEdit && <Link href="/attendance" className="btn"><Icon name="calendar" size={16} /> Attendance</Link>}
        {canEdit && <Link href="/payroll" className="btn primary"><Icon name="wallet" size={16} /> Run payroll</Link>}
      </div>

      <div className="split">
        <div className="card">
          <div className="card-h"><h3><span className="dot" /> Company</h3><span className="sp" />
            <Link href="/settings" className="icon-btn" aria-label="Company settings" title="Company & Rules"><Icon name="sliders" size={16} /></Link></div>
          <div className="profile-card">
            <div className={`big-av ${settings.logo ? '' : ''}`} style={settings.logo ? { background: '#fff', border: '1px solid var(--line)' } : undefined}>
              {settings.logo ? <img src={settings.logo} alt="" style={{ width: '78%', height: '78%', objectFit: 'contain' }} /> : initials(settings.company_name)}
              <span className="tag">{data.emps.length} active</span>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h2>{settings.company_name}</h2>
              <div className="facts">
                <div><small>Departments</small><span>{stats.depts.length}</span></div>
                <div><small>Latest attendance</small><span>{data.month ? monthLabel(data.month) : 'None yet'}</span></div>
                <div><small>Payslips generated</small><span>{data.month ? `${data.slips} / ${data.emps.length}` : '–'}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="tiles">
          <div className="tile"><small>Active employees</small><b>{data.emps.length}</b><div className="sub">{stats.depts.length} departments</div></div>
          <div className="tile"><small>On leave today</small><b>{data.away.length}</b><div className="sub">{fmtDate(today)}</div></div>
          <Link href="/leaves" className="tile" style={{ color: 'inherit' }}><small>Leave waiting for HR</small><b>{data.waitingCount}</b><div className="sub">{data.waitingCount ? 'Review now →' : 'All clear'}</div></Link>
          <div className="tile"><small>Net payroll</small><b>{data.month ? inrWhole(stats.net) : '–'}</b><div className="sub">{data.month ? monthLabel(data.month) : 'No attendance yet'}</div></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h3>Attendance{data.month ? ` · ${monthLabel(data.month)}` : ''}</h3><span className="sp" /><StripLegend company /></div>
        {data.month
          ? <AttendanceStrip month={data.month} marks={stats.marks} titles={stats.titles} today={today} />
          : <p className="muted">No attendance yet. <Link href="/attendance">Mark the first month</Link>.</p>}
        {data.month && stats.missing > 0 && <div className="note warn" style={{ marginTop: 10 }}>{stats.missing} employee(s) have no attendance for {monthLabel(data.month)}. <Link href="/attendance">Add it</Link>.</div>}
      </div>

      <div className="two">
        <div className="card">
          <div className="card-h"><h3>Leave waiting for HR</h3><span className="sp" /><Link href="/leaves" className="btn sm">See all</Link></div>
          {data.waiting.map(l => (
            <div key={l.id} className="who-c" style={{ padding: '9px 0', borderBottom: '1px solid var(--line-2)' }}>
              <span className="av">{initials(l.employees?.name ?? '?')}</span>
              <div style={{ flex: 1, minWidth: 0 }}><b>{l.employees?.name}</b><div className="muted small">{leaveLabel(l.leave_type)} · {when(l)} · {l.days} day(s)</div></div>
              {l.over_quota && <span className="pill warn">Over limit</span>}
            </div>
          ))}
          {!data.waiting.length && <p className="muted" style={{ margin: 0 }}>Nothing waiting. 🎉</p>}
          {data.away.length > 0 && <>
            <h3 style={{ marginTop: 18 }}>On leave today</h3>
            <div className="chips">{data.away.map(l => <span key={l.id} className="pill blue">{l.employees?.name} · {leaveLabel(l.leave_type)}</span>)}</div>
          </>}
        </div>
        <div className="card">
          <h3>Employees by department</h3>
          {stats.depts.map(([d, c]) => (
            <div className="bar-row" key={d}><span>{d}</span><div className="bar"><i style={{ width: `${(c / max) * 100}%` }} /></div><b>{c}</b></div>
          ))}
          {!stats.depts.length && <p className="muted">No employees yet. <Link href="/employees">Add the first one</Link>.</p>}
        </div>
      </div>
    </>
  );
}
