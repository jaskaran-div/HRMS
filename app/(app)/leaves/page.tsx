'use client';

import { ErrorBox } from '@/components/ui';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { LeaveStatus } from '@/components/LeaveStatus';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { currentYM, fmtDate, monthLabel, monthStart, shiftMonth } from '@/lib/dates';
import { leaveLabel } from '@/lib/leave';
import type { LeaveRequest } from '@/lib/types';

import { ask } from '@/components/Dialog';
type Row = LeaveRequest & { employees: { name: string; emp_code: string; department: string | null } | null };

const FILTERS = {
  '': { label: 'All', test: () => true },
  hr: { label: 'Pending with HR', test: (l: Row) => l.status === 'pending' && l.hr_status === 'pending' },
  tl: { label: 'Pending with team leader', test: (l: Row) => l.status === 'pending' && l.tl_status === 'pending' },
  approved: { label: 'Approved', test: (l: Row) => l.status === 'approved' },
  rejected: { label: 'Declined', test: (l: Row) => l.status === 'rejected' },
  cancelled: { label: 'Cancelled', test: (l: Row) => l.status === 'cancelled' },
} as const;
type Filter = keyof typeof FILTERS;

export default function LeavesPage() {
  const { canEdit, notify } = useApp();
  const [ym, setYm] = useState(currentYM());
  const [filter, setFilter] = useState<Filter>('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const month = monthStart(ym);

  const { data = [], loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const next = shiftMonth(month, 1);
    return fetchAll<Row>((a, b) => sb.from('leave_requests').select('*, employees(name, emp_code, department)')
      .lt('start_date', next).gte('end_date', month).order('start_date', { ascending: false }).range(a, b));
  }, [month]);

  // every open request, whatever the month
  const { data: open = [] } = useLoad(async () => {
    const { data } = await supabaseBrowser().from('leave_requests').select('*, employees(name, emp_code, department)')
      .eq('status', 'pending').order('start_date').limit(300);
    return (data ?? []) as Row[];
  }, [data]);
  const forHr = open.filter(FILTERS.hr.test);
  const forTl = open.filter(l => l.hr_status !== 'pending' && l.tl_status === 'pending');

  const list = useMemo(() => data.filter(l => FILTERS[filter].test(l) &&
    (!q.trim() || [l.employees?.name, l.employees?.emp_code, l.employees?.department].some(x => (x ?? '').toLowerCase().includes(q.trim().toLowerCase())))), [data, filter, q]);

  async function decide(l: Row, action: 'approve' | 'reject', countAs?: 'paid' | 'unpaid') {
    const note = await ask.prompt(action === 'reject'
      ? { title: `Decline ${l.employees?.name}'s leave?`, label: 'Reason (optional, the employee sees it)', multiline: true, confirmText: 'Decline', danger: true }
      : { title: `Approve ${l.employees?.name}'s leave${countAs ? (countAs === 'paid' ? ' as paid leave' : ' as absent') : ''}?`, label: 'Note (optional)', multiline: true, confirmText: 'Approve' });
    if (note === null) return;
    setBusy(l.id);
    const res = await fetch('/api/leave', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, action, note, as: 'hr', count_as: countAs }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { notify(j.error ?? 'Could not save', 'err'); return; }
    notify(action === 'approve' ? `HR approved${countAs ? ` · counts as ${countAs === 'paid' ? 'paid leave' : 'absent'}` : ''}` : 'HR declined');
    reload();
  }

  const when = (l: LeaveRequest) => (l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`);
  const row = (l: Row) => (
    <tr key={l.id}>
      <td>{l.employees ? <Link href={`/employees/${encodeURIComponent(l.employees.emp_code)}`}><b>{l.employees.name}</b></Link> : '—'}<div className="muted small">{l.employees?.emp_code}{l.employees?.department ? ` · ${l.employees.department}` : ''}</div></td>
      <td>{leaveLabel(l.leave_type)}</td>
      <td>{when(l)}<div className="muted small">applied {fmtDate(l.created_at)}</div></td>
      <td className="n">{l.days}</td>
      <td style={{ maxWidth: 240 }}>{l.reason || <span className="muted">—</span>}</td>
      <td><LeaveStatus l={l} /></td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {canEdit && l.status !== 'cancelled' && <>
          {l.hr_status !== 'approved' && (l.leave_type === 'short'
            ? <button className="btn sm primary" disabled={busy === l.id} onClick={() => decide(l, 'approve')}>Approve (HR)</button>
            : <>
                <button className="btn sm primary" disabled={busy === l.id} title="Approve; the days count as paid leave (no salary cut)" onClick={() => decide(l, 'approve', 'paid')}>Approve – paid</button>{' '}
                <button className="btn sm" disabled={busy === l.id} title="Approve; the days count as absent (salary cut)" onClick={() => decide(l, 'approve', 'unpaid')}>Approve – absent</button>
              </>)}{' '}
          {l.hr_status === 'approved' && l.leave_type !== 'short' && (
            <button className="btn sm" disabled={busy === l.id} title="Change whether this leave counts as paid leave or absent"
              onClick={() => decide(l, 'approve', l.leave_type === 'paid' ? 'unpaid' : 'paid')}>Count as {l.leave_type === 'paid' ? 'absent' : 'paid'}</button>
          )}{' '}
          {l.hr_status !== 'rejected' && <button className="btn sm danger" disabled={busy === l.id} onClick={() => decide(l, 'reject')}>Decline (HR)</button>}
        </>}
      </td>
    </tr>
  );
  const head = <thead><tr><th>Employee</th><th>Type</th><th>Date(s)</th><th className="n">Days</th><th>Reason</th><th>Status</th><th /></tr></thead>;

  return (
    <>
      <div className="page-h">
        <input type="month" value={ym} onChange={e => setYm(e.target.value || ym)} />
        <span className="sp" />
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}

      {forHr.length > 0 && (
        <div className="card">
          <h3>Waiting for HR ({forHr.length})</h3>
          <div className="tbl-wrap"><table>{head}<tbody>{forHr.map(row)}</tbody></table></div>
        </div>
      )}
      {forTl.length > 0 && (
        <div className="card">
          <h3>HR done · waiting for the team leader ({forTl.length})</h3>
          <div className="tbl-wrap"><table>{head}<tbody>{forTl.map(row)}</tbody></table></div>
        </div>
      )}

      <div className="card">
        <div className="tools">
          <input className="field grow" placeholder="Filter by name, ID, department…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)}>
            {(Object.keys(FILTERS) as Filter[]).map(k => <option key={k} value={k}>{FILTERS[k].label}</option>)}
          </select>
        </div>
        <h3 style={{ marginTop: 0 }}>{monthLabel(month)}</h3>
        <div className="tbl-wrap">
          <table>
            {head}
            <tbody>
              {list.map(row)}
              {!list.length && !loading && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 26 }}>No leave in {monthLabel(month)}.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Paid leave beyond the monthly allowance can still be requested — choose <b>Approve – paid</b> (no salary cut) or <b>Approve – absent</b>.
          Paid leave marked in attendance (L) never cuts salary, however many there are. Each request needs the team leader&apos;s and HR&apos;s approval (in any order); a decline from either one declines it. Employees with no team leader login
          only need HR. Both see each other&apos;s decision. Approved leave is a record only — mark the attendance as usual.
        </p>
      </div>
    </>
  );
}
