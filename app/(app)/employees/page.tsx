'use client';

import { ErrorBox } from '@/components/ui';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppContext';
import { FormModal } from '@/components/Modal';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { initials, inrWhole } from '@/lib/format';
import { fmtDate, todayISO } from '@/lib/dates';
import { rulesFrom } from '@/lib/payroll';
import { EXIT_TYPES } from '@/lib/exit-types';
import { buildExit, LEAVING_LABEL, leavingDate } from '@/lib/exit';
import { EMPLOYEE_FIELDS, employeeToValues, valuesToEmployee } from '@/lib/employee-form';
import type { Attendance, Employee, PayslipRow } from '@/lib/types';

const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export default function EmployeesPage() {
  const { canEdit, isAdmin, settings, notify } = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exitMonths, setExitMonths] = useState<3 | 6>(3);
  const [busy, setBusy] = useState(false);
  const [exitType, setExitType] = useState<string>(EXIT_TYPES[0]);
  const [problem, setProblem] = useState<string | null>(null);
  const [ask, setAsk] = useState<Record<string, string> | null>(null); // employee id -> date typed by HR

  const { data: all = [], loading, error, reload } = useLoad(() => {
    const sb = supabaseBrowser();
    return fetchAll<Employee>((a, b) => sb.from('employees').select('*').order('emp_code').range(a, b));
  }, []);

  const depts = useMemo(() => [...new Set(all.map(e => e.department).filter(Boolean) as string[])].sort(), [all]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter(e =>
      (archived ? !!e.archived_at : !e.archived_at) &&
      (!dept || e.department === dept) &&
      (!t || [e.emp_code, e.name, e.designation, e.department].some(x => (x ?? '').toLowerCase().includes(t))));
  }, [all, q, dept, archived]);

  const selected = list.filter(e => picked.has(e.id));
  const allShown = list.length > 0 && selected.length === list.length;
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allShown ? new Set() : new Set(list.map(e => e.id)));

  /** Start: employees with a saved date go straight through; for the others HR is asked for the date. */
  function bulkInactive() {
    const missing = selected.filter(e => !leavingDate(e));
    if (missing.length) { setAsk(Object.fromEntries(missing.map(e => [e.id, '']))); return; }
    void runInactive({});
  }

  /** `entered` = dates HR typed for employees that had none; they are saved on the employee as "Date of Leaving". */
  async function runInactive(entered: Record<string, string>) {
    const items = selected.map(e => ({ e, day: entered[e.id] || leavingDate(e)! }));
    if (!confirm(`Mark ${items.length} employee${items.length > 1 ? 's' : ''} inactive on their date of leaving? A relieving letter and the last ${exitMonths} months of payslips are saved for each.`)) return;
    setBusy(true);
    const sb = supabaseBrowser();
    try {
      for (const { e, day } of items) {
        if (!entered[e.id]) continue;
        const { error } = await sb.from('employees').update({ extra: { ...(e.extra ?? {}), [LEAVING_LABEL]: day } }).eq('id', e.id);
        if (error) throw new Error(error.message);
      }
      const ids = items.map(x => x.e.id);
      const att: Attendance[] = [];
      const slips: PayslipRow[] = [];
      for (const part of chunks(ids)) {
        att.push(...await fetchAll<Attendance>((a, b) => sb.from('attendance').select('*').in('employee_id', part).range(a, b)));
        slips.push(...await fetchAll<PayslipRow>((a, b) => sb.from('payslips').select('*').in('employee_id', part).range(a, b)));
      }
      const rules = rulesFrom(settings);
      const records = items.map(({ e, day }) => {
        const x = buildExit(e, att.filter(a => a.employee_id === e.id), slips.filter(s => s.employee_id === e.id), rules, day, exitMonths, todayISO());
        return { employee_id: e.id, relieved_on: day, payslip_months: exitMonths, letter: x.letter, payslips: x.payslips };
      });
      for (const part of chunks(records)) {
        const { error } = await sb.from('exit_records').upsert(part, { onConflict: 'employee_id' });
        if (error) throw new Error(error.message);
      }
      const { error } = await sb.from('employees').update({ archived_at: new Date().toISOString(), exit_type: exitType }).in('id', ids);
      if (error) throw new Error(error.message);
      notify(`${items.length} employee${items.length > 1 ? 's' : ''} marked inactive · relieving letters and payslips saved`);
      setAsk(null);
      setPicked(new Set());
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err');
    }
    setBusy(false);
  }

  async function bulkDelete() {
    setProblem(null);
    const n = selected.length;
    const s = n > 1 ? 's' : '';
    if (!confirm(`Permanently delete ${n} employee${s}?\n\nThis also deletes their attendance, payslips and exit documents and CANNOT be undone. (Use "Mark inactive" if you only want them out of payroll.)`)) return;
    if (prompt(`Type DELETE to confirm deleting ${n} employee${s}.`)?.trim() !== 'DELETE') return;
    setBusy(true);
    const sb = supabaseBrowser();
    let gone = 0;
    for (const part of chunks(selected.map(e => e.id))) {
      const { data, error } = await sb.from('employees').delete().in('id', part).select('id');
      if (error) { notify(error.message, 'err'); setBusy(false); reload(); return; }
      gone += data?.length ?? 0;
    }
    setBusy(false);
    if (!gone) { notify('Nothing was deleted. Only admins can delete employees, and the database needs the delete rule from supabase/schema.sql.', 'err'); return; }
    notify(`${gone} employee${gone > 1 ? 's' : ''} deleted`);
    setPicked(new Set());
    reload();
  }

  return (
    <>
      <div className="page-h">
        <h2>{archived ? 'Inactive employees' : 'Active employees'}</h2>
        <span className="muted">{loading ? 'Loading…' : `${list.length} shown`}</span>
        <span className="sp" />
        {canEdit && <button className="btn primary" onClick={() => setAdding(true)}>+ Add employee</button>}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}

      <div className="card">
        <div className="tools">
          <input className="field grow" placeholder="Filter by name, ID, designation…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts.map(d => <option key={d}>{d}</option>)}
          </select>
          <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setPicked(new Set()); setProblem(null); }} /> Show inactive
          </label>
        </div>
        {canEdit && selected.length > 0 && (
          <div className="note" style={{ marginBottom: 12 }}>
            <div className="row" style={{ marginBottom: 0 }}>
              <b>{selected.length} selected</b>
              {!archived && (
                <>
                  <label className="small">Reason{' '}
                    <select value={exitType} onChange={e => setExitType(e.target.value)}>{EXIT_TYPES.map(t => <option key={t}>{t}</option>)}</select>
                  </label>
                  <label className="small">Save payslips of last{' '}
                    <select value={exitMonths} onChange={e => setExitMonths(+e.target.value as 3 | 6)}><option value={3}>3 months</option><option value={6}>6 months</option></select>
                  </label>
                  <button className="btn" disabled={busy} onClick={bulkInactive}>{busy ? 'Working…' : 'Mark inactive'}</button>
                </>
              )}
              {isAdmin && <button className="btn danger" disabled={busy} onClick={bulkDelete}>Delete</button>}
              <button className="btn" disabled={busy} onClick={() => { setPicked(new Set()); setProblem(null); }}>Clear selection</button>
            </div>
          </div>
        )}
        {problem && <div className="note warn" style={{ marginBottom: 12 }}>{problem}</div>}
        {ask && (
          <div className="note warn" style={{ marginBottom: 12 }}>
            <p style={{ marginTop: 0 }}><b>Date of leaving is not saved for {Object.keys(ask).length} selected employee{Object.keys(ask).length > 1 ? 's' : ''}.</b> Enter it below — it is saved on the employee and used as the last working day.</p>
            <div className="tbl-wrap">
              <table>
                <tbody>
                  {selected.filter(e => e.id in ask).map(e => (
                    <tr key={e.id}>
                      <td><b>{e.name}</b> <span className="muted small">{e.emp_code}</span></td>
                      <td><input type="date" value={ask[e.id]} min={e.doj ?? undefined} onChange={ev => setAsk(a => ({ ...a, [e.id]: ev.target.value }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
              <button className="btn danger" disabled={busy || Object.values(ask).some(d => !d)} onClick={() => runInactive(ask)}>{busy ? 'Working…' : 'Save dates & mark inactive'}</button>
              <button className="btn" disabled={busy} onClick={() => setAsk(null)}>Cancel</button>
              {Object.values(ask).some(d => !d) && <span className="muted small">Fill every date to continue.</span>}
            </div>
          </div>
        )}
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              {canEdit && <th style={{ width: 28 }}><input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Select all shown" /></th>}
              <th>Employee</th><th>ID</th><th>Department</th><th>Designation</th><th>Joined</th>{archived && <th>Exit</th>}<th className="n">Monthly salary</th>
            </tr></thead>
            <tbody>
              {list.map(e => (
                <tr key={e.id} className="click" onClick={() => router.push(`/employees/${encodeURIComponent(e.emp_code)}`)}>
                  {canEdit && (
                    <td onClick={ev => ev.stopPropagation()}>
                      <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.name}`} />
                    </td>
                  )}
                  <td><div className="who-c"><div className="av">{initials(e.name)}</div><b>{e.name}</b></div></td>
                  <td>{e.emp_code}</td><td>{e.department}</td><td>{e.designation}</td><td>{fmtDate(e.doj)}</td>
                  {archived && <td>{e.exit_type ? <span className="pill gray">{e.exit_type}</span> : <span className="muted small">Not set</span>}{leavingDate(e) ? <span className="muted small"> · {fmtDate(leavingDate(e))}</span> : null}</td>}
                  <td className="n">{e.monthly_salary ? inrWhole(e.monthly_salary) : <span className="pill warn">Not set</span>}</td>
                </tr>
              ))}
              {!list.length && !loading && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                  {all.length ? 'No employees match.' : 'No employees yet — click “Add employee”, or use Import / Export to upload a sheet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <FormModal
          title="Add employee" fields={EMPLOYEE_FIELDS} initial={employeeToValues()} onClose={() => setAdding(false)}
          onSave={async v => {
            const row = valuesToEmployee(v);
            const { error } = await supabaseBrowser().from('employees').insert(row);
            if (error) return error.code === '23505' ? `Employee ID ${row.emp_code} already exists.` : error.message;
            notify(`${row.name} added`);
            reload();
          }}
        />
      )}
    </>
  );
}
