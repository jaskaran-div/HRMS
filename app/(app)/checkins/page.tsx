'use client';

import { useMemo, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useLoad } from '@/lib/use-load';
import { fmtDate, todayISO } from '@/lib/dates';
import { METHOD_LABEL } from '@/lib/checkin';
import type { Punch } from '@/lib/types';

type Row = Punch & { employees: { name: string; emp_code: string; department: string | null } | null };

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';

/** 'Office Wi-Fi (Main) · Web' */
function via(r: Punch) {
  if (!r.in_method) return '—';
  return `${METHOD_LABEL[r.in_method]}${r.in_network ? ` (${r.in_network})` : ''}${r.in_source ? ` · ${r.in_source === 'web' ? 'Web' : 'App'}` : ''}`;
}

const STATUS: Record<string, [string, string]> = {
  on_time: ['ok', 'On time'], late: ['warn', 'Late · Present'], half_day: ['bad', 'Late · Half day'],
};

function hours(a: string, b: string | null) {
  if (!b) return '—';
  const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Check-ins for one day (mobile app and web portal): who checked in, when, how (office location / Wi-Fi), and how far from the office. */
export default function CheckinsPage() {
  const [day, setDay] = useState(todayISO());
  const [q, setQ] = useState('');
  const { data = [], loading, error, reload } = useLoad(async () => {
    const { data, error } = await supabaseBrowser().from('attendance_punches')
      .select('*, employees(name, emp_code, department)').eq('day', day).order('in_at');
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
  }, [day]);

  const list = useMemo(() => data.filter(r => !q.trim() ||
    [r.employees?.name, r.employees?.emp_code, r.employees?.department].some(x => (x ?? '').toLowerCase().includes(q.trim().toLowerCase()))), [data, q]);

  return (
    <>
      <div className="page-h">
        <input type="date" value={day} max={todayISO()} onChange={e => e.target.value && setDay(e.target.value)} />
        <input placeholder="Search name, ID, department" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 220 }} />
        <span className="sp" />
        <span className="muted small">{loading ? 'Loading…' : `${data.length} checked in · ${fmtDate(day)}`}</span>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : (
        <div className="card">
          <h3>Check-ins</h3>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Department</th><th>Check in</th><th>Status</th><th>Checked in via</th><th>Check out</th><th>Time at work</th><th className="n">Distance in</th><th className="n">GPS ±</th></tr></thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.employees?.name ?? '—'}</b> <span className="muted small">{r.employees?.emp_code}</span></td>
                    <td>{r.employees?.department ?? '—'}</td>
                    <td>{time(r.in_at)}</td>
                    <td>{r.in_status ? <span className={`pill ${STATUS[r.in_status][0]}`}>{STATUS[r.in_status][1]}</span> : <span className="muted">—</span>}</td>
                    <td title={r.in_ip ? `IP ${r.in_ip}` : undefined}>{via(r)}</td>
                    <td>{r.out_missed && !r.out_at ? <span className="pill bad" title="Did not check out in time: the day became a half day">Missed · Half day</span> : time(r.out_at)}</td>
                    <td>{hours(r.in_at, r.out_at)}</td>
                    <td className="n">{r.in_distance_m != null ? `${Math.round(Number(r.in_distance_m))} m` : '—'}</td>
                    <td className="n">{r.in_accuracy_m != null ? `${Math.round(Number(r.in_accuracy_m))} m` : '—'}</td>
                  </tr>
                ))}
                {!list.length && !loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 26 }}>Nobody checked in on this day.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>A check-in marks the day in Attendance automatically — Present, or Half day for a late check-in under the office timing rule (unless HR had already marked that day). Office timing and how employees may check in (office location / office Wi-Fi): Company &amp; Rules.</p>
        </div>
      )}
    </>
  );
}
