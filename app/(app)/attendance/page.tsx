'use client';

import { ErrorBox, Skeleton } from '@/components/ui';
import { useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppContext';
import { AttendanceModal } from '@/components/AttendanceModal';
import { AttendanceGrid } from '@/components/AttendanceGrid';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { readSheet, downloadXlsx } from '@/lib/sheet';
import { parseAttendance, type ParsedAttendance, type ParsedAttendanceRow } from '@/lib/parse-attendance';
import { computePay, payFor, rulesFrom } from '@/lib/payroll';
import { loadCarry } from '@/lib/carry';
import { currentYM, daysInMonth, monthLabel, monthStart, shiftMonth } from '@/lib/dates';
import { inrWhole, norm } from '@/lib/format';
import type { ApprovedLeave } from '@/components/AttendanceGrid';
import type { Attendance, Employee } from '@/lib/types';

const matchEmployee = (r: ParsedAttendanceRow, emps: Employee[]): string => {
  if (r.code) { const e = emps.find(x => x.emp_code === r.code); if (e) return e.id; }
  const n = norm(r.name);
  if (!n) return '';
  const hits = emps.filter(x => norm(x.name) === n);
  return hits.length === 1 ? hits[0].id : '';
};

export default function AttendancePage() {
  const { canEdit, settings, notify } = useApp();
  const rules = rulesFrom(settings);
  const [ym, setYm] = useState(() => shiftMonth(`${currentYM()}-01`, -1).slice(0, 7));
  const month = monthStart(ym);
  const [y, m] = ym.split('-').map(Number);
  const dim = daysInMonth(y, m);

  const [mode, setMode] = useState<'enter' | 'upload'>('enter');
  const [parsed, setParsed] = useState<ParsedAttendance | null>(null);
  const [assign, setAssign] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<{ emp: Employee; existing?: Attendance } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [emps, att, leaves] = await Promise.all([
      fetchAll<Employee>((a, b) => sb.from('employees').select('*').is('archived_at', null).order('emp_code').range(a, b)),
      fetchAll<Attendance>((a, b) => sb.from('attendance').select('*').eq('month', month).range(a, b)),
      // fully approved leave overlapping this month (shown on the grid)
      fetchAll<ApprovedLeave>((a, b) => sb.from('leave_requests').select('employee_id, leave_type, start_date, end_date')
        .eq('status', 'approved').lt('start_date', shiftMonth(month, 1)).gte('end_date', month).range(a, b)).catch(() => [] as ApprovedLeave[]),
    ]);
    const carry = await loadCarry(sb, month, emps, rules);
    return { month, emps, att, carry, leaves };
  }, [month]);
  const emps = data?.emps ?? [];
  const attByEmp = useMemo(() => new Map((data?.att ?? []).map(a => [a.employee_id, a])), [data]);
  const empById = useMemo(() => new Map(emps.map(e => [e.id, e])), [emps]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const p = parseAttendance(await readSheet(file), y, m);
      setParsed(p);
      setAssign(p.rows.map(r => matchEmployee(r, emps)));
      setFileName(file.name);
    } catch (e) {
      notify(`Could not read that file: ${e instanceof Error ? e.message : e}`, 'err');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const preview = useMemo(() => (parsed?.rows ?? []).map((r, i) => {
    const e = empById.get(assign[i]);
    const total = Object.values(r.counts).reduce((s, x) => s + (x ?? 0), 0);
    const pay = e ? computePay({
      salary: r.salary ?? e.monthly_salary, arrears: r.arrears, otherDeduction: r.otherDeduction,
      pf: e.pf_amount, tds: e.tds_amount, att: r.counts, daysInMonth: dim,
    }, rules) : null;
    return { r, e, pay, tooMany: total > dim };
  }), [parsed, assign, empById, dim, rules]);

  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    assign.filter(Boolean).forEach(id => seen.set(id, (seen.get(id) ?? 0) + 1));
    return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  }, [assign]);
  const ready = preview.filter(p => p.e && !p.tooMany);
  const unmatched = preview.filter(p => !p.e).length;
  const replacing = ready.filter(p => attByEmp.has(p.e!.id)).length;
  const blocked = dupes.size > 0 || preview.some(p => p.tooMany && p.e);

  async function save() {
    if (!ready.length) return;
    setSaving(true);
    const sb = supabaseBrowser();
    const rows = ready.map(({ r, e }) => ({
      employee_id: e!.id, month, salary: r.salary ?? e!.monthly_salary,
      present_days: r.counts.present, half_days: r.counts.half, absent_days: r.counts.absent, leave_days: r.counts.leave, short_leave_days: r.counts.short ?? 0,
      weekoff_days: r.counts.weekoff, holiday_days: r.counts.holiday, arrears: r.arrears, other_deduction: r.otherDeduction, daily: r.daily,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await sb.from('attendance').upsert(rows.slice(i, i + 100), { onConflict: 'employee_id,month' });
      if (error) { notify(error.message, 'err'); setSaving(false); return; }
    }
    // employees whose master salary was never filled in: take it from the sheet
    for (const { r, e } of ready) if (!Number(e!.monthly_salary) && r.salary) await sb.from('employees').update({ monthly_salary: r.salary }).eq('id', e!.id);
    setSaving(false);
    notify(`Saved attendance for ${rows.length} employees — ${monthLabel(month)}`);
    setParsed(null); setAssign([]);
    reload();
  }

  function template() {
    const mon = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
    downloadXlsx(emps.map(e => {
      const row: Record<string, unknown> = { 'Employee ID': e.emp_code, 'Employee Name': e.name, Department: e.department ?? '', Salary: e.monthly_salary, Arrears: 0, Deduction: 0 };
      for (let d = 1; d <= dim; d++) row[`${d}-${mon}`] = '';
      return row;
    }), 'Attendance', `attendance_template_${ym}.xlsx`);
  }

  const missing = emps.filter(e => !attByEmp.has(e.id)).length;

  return (
    <>
      <div className="page-h">
        <input type="month" value={ym} onChange={e => { setYm(e.target.value || ym); setParsed(null); }} />
        {canEdit && (
          <div className="seg">
            <button className={mode === 'enter' ? 'on' : ''} onClick={() => setMode('enter')}>Enter in app</button>
            <button className={mode === 'upload' ? 'on' : ''} onClick={() => setMode('upload')}>Upload a sheet (optional)</button>
          </div>
        )}
        <span className="muted">{loading ? 'Loading…' : `${(data?.att.length ?? 0)} of ${emps.length} employees have attendance for ${monthLabel(month)}`}</span>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}

      {mode === 'enter' && (data && data.month === month
        ? <AttendanceGrid month={month} emps={data.emps} att={data.att} carry={data.carry} leaves={data.leaves} readOnly={!canEdit} onSaved={reload} />
        : <Skeleton rows={8} />)}

      {mode === 'upload' && canEdit && (
        <div className="card">
          <h3>Upload attendance sheet for {monthLabel(month)}</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            One row per employee with a column for each day (Present / Absent / Week Off / Half Day / Paid Leave / Short Leave; leave a day blank if the person had not joined or had left).
            Columns Salary, Arrears and Deduction are optional. Employees are matched by Employee ID, or by name if there is no ID column.
          </p>
          <div className="row tight">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => onFile(e.target.files?.[0])} />
            <button className="btn" onClick={template} disabled={!emps.length}>Download blank sheet for this month</button>
          </div>
        </div>
      )}

      {mode === 'upload' && parsed && (
        <div className="card">
          <h3>Check before saving — {fileName}</h3>
          {parsed.warnings.length > 0 && <div className="note warn"><ul>{parsed.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          <p className="small muted">
            {parsed.dayColumns >= 10 ? `Read ${parsed.dayColumns} day columns.` : 'Using the summary columns (no day-by-day columns found).'}{' '}
            {ready.length} ready{unmatched ? `, ${unmatched} not matched to an employee (pick one below or they are skipped)` : ''}
            {replacing ? `, ${replacing} already have attendance for this month and will be replaced` : ''}.
          </p>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Name in sheet</th><th>Employee</th><th className="n">Present</th><th className="n">Half</th><th className="n">Absent</th><th className="n">Leave</th><th className="n">Short</th><th className="n">Week off</th><th className="n">Paid days</th><th className="n">Net pay</th></tr></thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} className={!p.e || p.tooMany || (p.e && dupes.has(p.e.id)) ? 'bad' : ''}>
                    <td>{p.r.name || p.r.code}</td>
                    <td>
                      <select value={assign[i]} onChange={ev => setAssign(a => a.map((x, j) => (j === i ? ev.target.value : x)))}>
                        <option value="">— not matched —</option>
                        {emps.map(e => <option key={e.id} value={e.id}>{e.emp_code} · {e.name}</option>)}
                      </select>
                      {p.e && dupes.has(p.e.id) && <span className="pill bad" style={{ marginLeft: 6 }}>Duplicate</span>}
                      {p.tooMany && <span className="pill bad" style={{ marginLeft: 6 }}>More than {dim} days</span>}
                    </td>
                    <td className="n">{p.r.counts.present}</td><td className="n">{p.r.counts.half}</td><td className="n">{p.r.counts.absent}</td>
                    <td className="n">{p.r.counts.leave}</td><td className="n">{p.r.counts.short ?? 0}</td><td className="n">{p.r.counts.weekoff}</td>
                    <td className="n">{p.pay ? p.pay.paidDays : '–'}</td>
                    <td className="n">{p.pay ? (p.pay.net ? inrWhole(p.pay.net) : <span className="pill warn">No salary</span>) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" disabled={saving || !ready.length || blocked} onClick={save}>
              {saving ? 'Saving…' : `Save attendance for ${ready.length} employees`}
            </button>
            <button className="btn" onClick={() => { setParsed(null); setAssign([]); }}>Cancel</button>
            {blocked && <span className="err small">Fix the red rows first.</span>}
          </div>
        </div>
      )}

      <div className="card" style={mode === 'upload' ? undefined : { display: 'none' }}>
        <h3>Saved for {monthLabel(month)} {missing > 0 && <span className="pill warn" style={{ marginLeft: 6 }}>{missing} missing</span>}</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Employee</th><th>ID</th><th className="n">Present</th><th className="n">Half</th><th className="n">Absent</th><th className="n">Leave</th><th className="n">Short</th><th className="n">Week off</th><th className="n">Paid days</th><th className="n">LOP</th><th className="n">Net pay</th><th /></tr></thead>
            <tbody>
              {emps.map(e => {
                const a = attByEmp.get(e.id);
                const p = a ? payFor(e, a, rules) : null;
                return (
                  <tr key={e.id}>
                    <td><b>{e.name}</b></td><td>{e.emp_code}</td>
                    {a && p ? (
                      <>
                        <td className="n">{a.present_days}</td><td className="n">{a.half_days}</td><td className="n">{a.absent_days}</td>
                        <td className="n">{Number(a.leave_days) + p.leaveConverted}</td><td className="n">{Number(a.short_leave_days ?? 0)}</td><td className="n">{a.weekoff_days}</td>
                        <td className="n">{p.paidDays}</td><td className="n">{p.lopDays}</td><td className="n">{inrWhole(p.net)}</td>
                      </>
                    ) : <td colSpan={9}><span className="pill warn">No attendance yet</span></td>}
                    <td style={{ textAlign: 'right' }}>{canEdit && <button className="btn sm" onClick={() => setEdit({ emp: e, existing: a })}>{a ? 'Edit' : 'Add'}</button>}</td>
                  </tr>
                );
              })}
              {!emps.length && !loading && <tr><td colSpan={12} className="muted" style={{ textAlign: 'center', padding: 26 }}>Import your employees first (Import / Export).</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {edit && <AttendanceModal emp={edit.emp} month={month} existing={edit.existing} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}
