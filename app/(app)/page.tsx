'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { payFor, rulesFrom } from '@/lib/payroll';
import { monthLabel } from '@/lib/dates';
import { inrWhole } from '@/lib/format';
import type { Attendance, Employee } from '@/lib/types';

export default function Dashboard() {
  const { settings, profile, canEdit } = useApp();
  const rules = rulesFrom(settings);

  const { data, loading, error } = useLoad(async () => {
    const sb = supabaseBrowser();
    const emps = await fetchAll<Employee>((a, b) => sb.from('employees').select('*').is('archived_at', null).order('emp_code').range(a, b));
    const { data: latest } = await sb.from('attendance').select('month').order('month', { ascending: false }).limit(1);
    const month: string | null = latest?.[0]?.month ?? null;
    const att = month ? await fetchAll<Attendance>((a, b) => sb.from('attendance').select('*').eq('month', month).range(a, b)) : [];
    const { count } = month
      ? await sb.from('payslips').select('id', { count: 'exact', head: true }).eq('month', month)
      : { count: 0 };
    return { emps, month, att, slips: count ?? 0 };
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const attBy = new Map(data.att.map(a => [a.employee_id, a]));
    let net = 0;
    for (const e of data.emps) { const a = attBy.get(e.id); if (a) net += payFor(e, a, rules).net; }
    const depts = new Map<string, number>();
    data.emps.forEach(e => depts.set(e.department || 'Unassigned', (depts.get(e.department || 'Unassigned') ?? 0) + 1));
    return { net, depts: [...depts].sort((a, b) => b[1] - a[1]), missing: data.emps.filter(e => !attBy.has(e.id)).length };
  }, [data, rules]);

  if (error) return <p className="err">{error}</p>;
  if (!data || !stats) return <p className="muted">{loading ? 'Loading…' : ''}</p>;

  const max = stats.depts[0]?.[1] ?? 1;
  const empty = data.emps.length === 0;

  return (
    <>
      <div className="page-h"><h2>Welcome, {profile.full_name.split(' ')[0]}</h2></div>
      <div className="kpis">
        <div className="kpi"><div className="ico">👥</div><div><small>Active employees</small><b>{data.emps.length}</b></div></div>
        <div className="kpi"><div className="ico">🏢</div><div><small>Departments</small><b>{stats.depts.length}</b></div></div>
        <div className="kpi"><div className="ico">💰</div><div><small>Net payroll{data.month ? ` · ${monthLabel(data.month)}` : ''}</small><b>{data.month ? inrWhole(stats.net) : '–'}</b></div></div>
        <div className="kpi"><div className="ico">🧾</div><div><small>Payslips generated</small><b>{data.month ? `${data.slips} / ${data.emps.length}` : '–'}</b></div></div>
      </div>

      <div className="two">
        <div className="card">
          <h3>Each month</h3>
          <ol className="steps">
            <li className={empty ? '' : 'muted'}><b>Employees</b> — upload your employee sheet once (with each person&apos;s monthly salary). <Link href="/import">Import</Link></li>
            <li><b>Attendance</b> — upload the month&apos;s attendance sheet. <Link href="/attendance">Attendance</Link></li>
            <li><b>Payslips</b> — check the amounts, generate, download. <Link href="/payroll">Payroll</Link></li>
          </ol>
          {data.month && stats.missing > 0 && <div className="note warn" style={{ marginTop: 10 }}>{stats.missing} employee(s) have no attendance for {monthLabel(data.month)}.</div>}
          {!canEdit && <div className="note" style={{ marginTop: 10 }}>You have view-only access.</div>}
        </div>
        <div className="card">
          <h3>Employees by department</h3>
          {stats.depts.map(([d, c]) => (
            <div className="bar-row" key={d}><span>{d}</span><div className="bar"><i style={{ width: `${(c / max) * 100}%` }} /></div><b>{c}</b></div>
          ))}
          {!stats.depts.length && <p className="muted">No employees yet.</p>}
        </div>
      </div>
    </>
  );
}
