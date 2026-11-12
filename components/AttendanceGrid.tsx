'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { computePay, rulesFrom, type AttendanceCounts, type Carry } from '@/lib/payroll';
import { daysInMonth, isOffSaturday, monthLabel, shiftMonth } from '@/lib/dates';
import { inrWhole, num } from '@/lib/format';
import { leaveLabel } from '@/lib/leave';
import type { Attendance, Employee, LeaveRequest } from '@/lib/types';

import { ask } from './Dialog';
const BRUSHES = [
  { code: 'P', label: 'Present', cls: 'p', key: 'present' },
  { code: 'A', label: 'Absent', cls: 'a', key: 'absent' },
  { code: 'W', label: 'Week off', cls: 'w', key: 'weekoff' },
  { code: 'H', label: 'Half day', cls: 'h', key: 'half' },
  { code: 'L', label: 'Paid leave', cls: 'l', key: 'leave' },
  { code: 'S', label: 'Short leave', cls: 's', key: 'short' },
  { code: 'O', label: 'Holiday', cls: 'o', key: 'holiday' },
  { code: '', label: 'Clear', cls: '', key: '' },
] as const;
const KEY_OF: Record<string, keyof AttendanceCounts> = { P: 'present', A: 'absent', W: 'weekoff', H: 'half', L: 'leave', O: 'holiday', S: 'short' };
/** Attendance mark for an approved leave request. */
const LEAVE_CODE = { short: 'S', paid: 'L', unpaid: 'A' } as const;

export type ApprovedLeave = Pick<LeaveRequest, 'employee_id' | 'leave_type' | 'start_date' | 'end_date'>;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Days = Record<number, string>;
interface RowState { days: Days; arrears: string; deduction: string; dirty: boolean }

const countsOf = (days: Days): AttendanceCounts => {
  const c: AttendanceCounts = { present: 0, half: 0, absent: 0, leave: 0, weekoff: 0, holiday: 0, short: 0 };
  Object.values(days).forEach(code => { const k = KEY_OF[code]; if (k) c[k] = (c[k] ?? 0) + 1; });
  return c;
};

/** Day-by-day attendance for one month. `month` is YYYY-MM-01. */
export function AttendanceGrid({ month, emps, att, carry, readOnly, onSaved, leaves = [] }: {
  month: string; emps: Employee[]; att: Attendance[]; carry: Map<string, Carry>; readOnly: boolean; onSaved: () => void;
  /** Fully approved leave overlapping this month: shown on the grid and can be filled in with one click. */
  leaves?: ApprovedLeave[];
}) {
  const { settings, notify } = useApp();
  const rules = rulesFrom(settings);
  const [y, m] = month.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const days = useMemo(() => Array.from({ length: dim }, (_, i) => i + 1), [dim]);
  const dow = (d: number) => new Date(y, m - 1, d).getDay();

  const [brush, setBrush] = useState('P');
  const [weekOff, setWeekOff] = useState(0);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const painting = useRef(false);

  const attBy = useMemo(() => new Map(att.map(a => [a.employee_id, a])), [att]);
  /** employee id -> day -> { code, label } from approved leave (week offs skipped). */
  const leaveDays = useMemo(() => {
    const out = new Map<string, Map<number, { code: string; label: string }>>();
    const ym = month.slice(0, 7);
    for (const l of leaves) {
      for (let d = 1; d <= dim; d++) {
        const iso = `${ym}-${String(d).padStart(2, '0')}`;
        if (iso < l.start_date || iso > l.end_date) continue;
        const wd = new Date(y, m - 1, d).getDay();
        if (wd === 0 || isOffSaturday(y, m, d)) continue;
        if (!out.has(l.employee_id)) out.set(l.employee_id, new Map());
        out.get(l.employee_id)!.set(d, { code: LEAVE_CODE[l.leave_type], label: leaveLabel(l.leave_type) });
      }
    }
    return out;
  }, [leaves, month, dim, y, m]);
  const init = () => Object.fromEntries(emps.map(e => {
    const a = attBy.get(e.id);
    const d: Days = {};
    Object.entries(a?.daily ?? {}).forEach(([k, v]) => { d[+k] = v; });
    return [e.id, { days: d, arrears: String(a?.arrears ?? 0), deduction: String(a?.other_deduction ?? 0), dirty: false } as RowState];
  }));
  const [rows, setRows] = useState<Record<string, RowState>>(init);
  // reload from the database after a save / month change
  useEffect(() => { setRows(init()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [att, emps, month]);

  useEffect(() => {
    const up = () => { painting.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  const dirtyCount = Object.values(rows).filter(r => r.dirty).length;
  useEffect(() => {
    if (!dirtyCount) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyCount]);

  /** First day of this month the person was employed (days before are greyed out). */
  const firstDay = (e: Employee) => {
    if (!e.doj) return 1;
    const [jy, jm, jd] = e.doj.split('-').map(Number);
    if (jy > y || (jy === y && jm > m)) return 99;
    return jy === y && jm === m ? jd : 1;
  };

  /** The 2nd and 4th Saturday are week offs unless HR painted something else on that day. */
  const auto = (e: Employee, d: number) => (d >= firstDay(e) && isOffSaturday(y, m, d) ? 'W' : undefined);
  const effective = (e: Employee, marked: Days): Days => {
    const out = { ...marked };
    for (const d of days) if (out[d] === undefined && auto(e, d)) out[d] = 'W';
    // approved leave counts on days HR has not marked (shown, counted and saved with the row)
    const lv = leaveDays.get(e.id);
    if (lv) for (const [d, x] of lv) if (out[d] === undefined && d >= firstDay(e)) out[d] = x.code;
    return out;
  };

  const edit = (id: string, fn: (r: RowState) => RowState) => setRows(rs => ({ ...rs, [id]: { ...fn(rs[id]), dirty: true } }));
  const paint = (e: Employee, d: number) => {
    if (readOnly || d < firstDay(e)) return;
    edit(e.id, r => { const nd = { ...r.days }; if (brush) nd[d] = brush; else delete nd[d]; return { ...r, days: nd }; });
  };
  const bulk = (fn: (e: Employee, d: number, cur: string | undefined) => string | null | undefined, only?: Employee[]) =>
    setRows(rs => {
      const out = { ...rs };
      for (const e of only ?? emps) {
        const r = rs[e.id]; const nd = { ...r.days }; let changed = false;
        for (const d of days) {
          if (d < firstDay(e)) continue;
          const v = fn(e, d, nd[d] ?? auto(e, d));
          if (v === undefined) continue;
          if (v === null || v === '') { if (nd[d] !== undefined) { delete nd[d]; changed = true; } } else if (nd[d] !== v) { nd[d] = v; changed = true; }
        }
        if (changed) out[e.id] = { ...r, days: nd, dirty: true };
      }
      return out;
    });

  async function save() {
    const todo = emps.filter(e => rows[e.id]?.dirty);
    if (!todo.length) return;
    setSaving(true);
    const payload = todo.map(e => {
      const r = rows[e.id]; const eff = effective(e, r.days); const c = countsOf(eff);
      return {
        employee_id: e.id, month, salary: Number(attBy.get(e.id)?.salary) || Number(e.monthly_salary) || 0,
        present_days: c.present, half_days: c.half, absent_days: c.absent, leave_days: c.leave, weekoff_days: c.weekoff, holiday_days: c.holiday,
        short_leave_days: c.short ?? 0,
        arrears: num(r.arrears), other_deduction: num(r.deduction),
        daily: Object.fromEntries(Object.entries(eff).map(([k, v]) => [String(k), v])),
      };
    });
    const sb = supabaseBrowser();
    for (let i = 0; i < payload.length; i += 100) {
      const { error } = await sb.from('attendance').upsert(payload.slice(i, i + 100), { onConflict: 'employee_id,month' });
      if (error) { notify(error.message, 'err'); setSaving(false); return; }
    }
    setSaving(false);
    notify(`Saved attendance for ${payload.length} employee${payload.length > 1 ? 's' : ''} — ${monthLabel(month)}`);
    onSaved();
  }

  /** Last month's arrears / deductions were already settled: stop bringing them forward into this month. */
  async function clearCarry(e: Employee) {
    const cf = carry.get(e.id);
    if (!(await ask.confirm({ title: 'Mark as already cleared?', message: `Last month's arrears / deductions for ${e.name} will no longer carry forward into ${monthLabel(month)}.`, confirmText: 'Mark cleared', tone: 'warn' }))) return;
    const { error } = await supabaseBrowser().from('attendance').update({ carry_cleared: true })
      .eq('employee_id', e.id).eq('month', shiftMonth(month, -1));
    if (error) { notify(error.message, 'err'); return; }
    notify(`Cleared${cf?.arrears ? ` ₹${cf.arrears}` : ''} brought-forward amount for ${e.name}`);
    onSaved();
  }

  /** Approved-leave days whose mark differs from the leave (what "Fill approved leave" would change). */
  const pendingLeave = emps.reduce((n, e) => n + [...(leaveDays.get(e.id) ?? [])]
    .filter(([d, x]) => d >= firstDay(e) && (rows[e.id]?.days[d] ?? auto(e, d)) !== x.code).length, 0);
  const shown = emps.filter(e => !q.trim() || `${e.name} ${e.emp_code}`.toLowerCase().includes(q.trim().toLowerCase()));
  const noSalary = emps.filter(e => !Number(e.monthly_salary) && !Number(attBy.get(e.id)?.salary)).length;

  return (
    <div className="card" onMouseLeave={() => { painting.current = false; }}>
      {!readOnly && (
        <>
          <div className="row">
            <span className="muted small">Pick a status, then click or drag over the days:</span>
            {BRUSHES.map(b => (
              <button key={b.code || 'x'} className={`brush ${b.cls} ${brush === b.code ? 'on' : ''}`} onClick={() => setBrush(b.code)}>
                {b.code ? <b>{b.code}</b> : '✕'} {b.label}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => bulk((_, __, cur) => (cur ? undefined : 'P'))}>Fill empty days with Present</button>
            <span className="small muted">Week off day</span>
            <select value={weekOff} onChange={e => setWeekOff(+e.target.value)}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select>
            <button className="btn sm" onClick={() => bulk((_, d) => (dow(d) === weekOff ? 'W' : undefined))}>Mark as Week off</button>
            {pendingLeave > 0 && (
              <button className="btn sm primary" title="Marks S / L / A on the days of fully approved leave requests (week offs are skipped)"
                onClick={() => bulk((e, d) => leaveDays.get(e.id)?.get(d)?.code)}>
                Fill approved leave ({pendingLeave} day{pendingLeave > 1 ? 's' : ''})
              </button>
            )}
            <button className="btn sm danger" onClick={async () => { if (await ask.confirm({ title: 'Clear all days?', message: 'Every day for everyone shown on screen is emptied. Nothing is saved until you press Save.', confirmText: 'Clear all', danger: true })) bulk(() => null); }}>Clear all</button>
            <span className="sp" style={{ flex: 1 }} />
            <input className="field" placeholder="Find employee…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 170 }} />
          </div>
          <p className="muted small" style={{ margin: '0 0 10px' }}>
            Click a <b>day number</b> to apply the selected status to everyone that day (e.g. a public holiday). Click <b>“P”</b> next to a name to mark that person present on all empty days.
            The <b>2nd and 4th Saturday</b> are week offs automatically (no salary cut) — paint over them if someone worked.
            Days before someone&apos;s joining date are greyed out. Nothing is saved until you press <b>Save</b>.
          </p>
        </>
      )}
      {noSalary > 0 && <div className="note warn" style={{ marginBottom: 10 }}>{noSalary} employee(s) have no monthly salary yet — their pay shows as ₹0. Add it on the employee&apos;s page.</div>}

      <div className="grid-wrap">
        <table className="ag">
          <thead>
            <tr>
              <th className="name">Employee</th>
              {days.map(d => (
                <th key={d} className={dow(d) === 0 ? 'sun' : ''}>
                  <button className="dayh" disabled={readOnly} title="Apply selected status to everyone" onClick={() => bulk((e, dd) => (dd === d ? (brush || null) : undefined))}>
                    {d}<small>{'SMTWTFS'[dow(d)]}</small>
                  </button>
                </th>
              ))}
              <th>P</th><th>A</th><th>W</th><th>½</th><th>L</th><th title="Short leave">S</th><th>Paid</th><th>Arrears ₹</th><th>Deduct ₹</th><th>Net pay</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(e => {
              const r = rows[e.id]; if (!r) return null;
              const a = attBy.get(e.id);
              const totalsOnly = !!a && !a.daily && !r.dirty;
              const shownDays = effective(e, r.days);
              const c = totalsOnly
                ? { present: +a!.present_days, half: +a!.half_days, absent: +a!.absent_days, leave: +a!.leave_days, weekoff: +a!.weekoff_days, holiday: +a!.holiday_days, short: +(a!.short_leave_days ?? 0) }
                : countsOf(shownDays);
              const pay = computePay({
                salary: Number(a?.salary) || Number(e.monthly_salary) || 0, arrears: num(r.arrears), otherDeduction: num(r.deduction),
                pf: Number(e.pf_amount), tds: Number(e.tds_amount), att: c, daysInMonth: dim, carry: carry.get(e.id),
              }, rules);
              const cf = carry.get(e.id);
              const fd = firstDay(e);
              return (
                <tr key={e.id} className={r.dirty ? 'dirty' : ''}>
                  <td className="name">
                    <div className="nm"><b>{e.name}</b><small>{e.emp_code}</small></div>
                    {!readOnly && <button className="mini" title="Mark present on all empty days" onClick={() => bulk((_, __, cur) => (cur ? undefined : 'P'), [e])}>P</button>}
                  </td>
                  {days.map(d => {
                    const v = shownDays[d];
                    const off = d < fd;
                    const b = BRUSHES.find(x => x.code === v);
                    const lv = off ? undefined : leaveDays.get(e.id)?.get(d);
                    const hint = lv ? (lv.code === v ? ' · leave approved ✓' : ` · approved ${lv.label}`) : '';
                    return (
                      <td key={d} className={dow(d) === 0 ? 'sun' : ''}>
                        <button
                          className={`cell ${off ? 'off' : b?.cls ?? ''} ${lv && lv.code !== v ? 'lv' : ''}`} disabled={readOnly || off}
                          onMouseDown={() => { painting.current = true; paint(e, d); }}
                          onMouseEnter={() => painting.current && paint(e, d)}
                          title={off ? 'Not joined yet' : (b?.label ?? 'Not marked') + hint}
                        >{off ? '' : v ?? ''}</button>
                      </td>
                    );
                  })}
                  <td className="n">{c.present}</td><td className="n">{c.absent}</td><td className="n">{c.weekoff}</td><td className="n">{c.half}</td><td className="n">{c.leave + pay.leaveConverted}</td>
                  <td className="n" title={pay.shortHalf ? `${pay.shortHalf} extra short leave(s) paid as half day` : undefined}>{c.short ?? 0}{pay.shortHalf ? '*' : ''}</td>
                  <td className="n"><b>{pay.paidDays}</b></td>
                  <td><input className="mi" value={r.arrears} disabled={readOnly} inputMode="decimal" onChange={ev => edit(e.id, s => ({ ...s, arrears: ev.target.value }))} /></td>
                  <td><input className="mi" value={r.deduction} disabled={readOnly} inputMode="decimal" onChange={ev => edit(e.id, s => ({ ...s, deduction: ev.target.value }))} /></td>
                  <td className="n"><b>{inrWhole(pay.net)}</b>{totalsOnly && <div className="muted" style={{ fontSize: 10 }}>totals only</div>}
                    {cf && (cf.arrears > 0 || cf.deduction > 0) && (
                      <div className="muted" style={{ fontSize: 10 }} title="Brought forward from last month and already included in this net pay">
                        b/f {cf.arrears > 0 ? `+${inrWhole(cf.arrears)}` : ''} {cf.deduction > 0 ? `−${inrWhole(cf.deduction)}` : ''}
                        {!readOnly && <button className="mini" style={{ marginLeft: 4 }} title="Already settled last month — stop carrying it forward" onClick={() => clearCarry(e)}>Cleared</button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={dim + 11} className="muted" style={{ padding: 24 }}>{emps.length ? 'No one matches.' : 'No employees yet — add them on the Employees page first.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className="btn primary" disabled={saving || !dirtyCount} onClick={save}>{saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'Saved'}</button>
          {dirtyCount > 0 && <button className="btn" onClick={() => setRows(init())}>Discard changes</button>}
          <span className="muted small">Paid = Present + ½ Half + Week off + Holiday + Paid leave + Short leave, plus {Number(settings.paid_leave_per_month)} paid leave for the first absence.
            {' '}{Number(settings.short_leave_per_month ?? 1)} short leave a month is fully paid; each extra one (marked *) is paid as half a day.
            Days with approved leave that are not marked yet have a dotted outline.</span>
        </div>
      )}
    </div>
  );
}
