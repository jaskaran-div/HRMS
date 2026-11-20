'use client';

import { useMemo, useState } from 'react';
import { useApp } from './AppContext';
import { Modal } from './Modal';
import { TimePicker } from './TimePicker';
import { ErrorBox } from './ui';
import { ask } from './Dialog';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useLoad } from '@/lib/use-load';
import { fetchAll } from '@/lib/fetch-all';
import { fmtTime, toMinutes, windows } from '@/lib/late';
import type { Employee, Shift } from '@/lib/types';

type Emp = Pick<Employee, 'id' | 'name' | 'emp_code' | 'department' | 'shift_id'>;

/**
 * Company & Rules → Shifts. HR adds shifts (name, start, end) and picks the employees on each. An employee on a shift
 * gets every check-in / check-out window moved with the shift; everyone else follows the company office timing.
 */
export function ShiftsCard() {
  const { settings, notify } = useApp();
  const [editing, setEditing] = useState<Partial<Shift> | null>(null);
  const [assigning, setAssigning] = useState<Shift | null>(null);
  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [{ data: shifts, error: e1 }, emps] = await Promise.all([
      sb.from('shifts').select('*').order('start_time'),
      fetchAll<Emp>((a, b) => sb.from('employees').select('id, name, emp_code, department, shift_id').is('archived_at', null).order('name').range(a, b)),
    ]);
    if (e1) throw new Error(e1.message);
    return { shifts: (shifts ?? []) as Shift[], emps };
  }, []);
  const shifts = data?.shifts ?? [];
  const emps = data?.emps ?? [];
  const countOf = (id: string) => emps.filter(e => e.shift_id === id).length;

  async function remove(s: Shift) {
    const n = countOf(s.id);
    if (!(await ask.confirm({
      title: `Delete the ${s.name} shift?`, confirmText: 'Delete', danger: true,
      message: n ? `${n} employee(s) on it go back to the company office timing.` : undefined,
    }))) return;
    const { error } = await supabaseBrowser().from('shifts').delete().eq('id', s.id);
    if (error) { notify(error.message, 'err'); return; }
    notify('Shift deleted');
    reload();
  }

  const w = windows(settings);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Shifts</h3>
        <span className="sp" style={{ flex: 1 }} />
        <button type="button" className="btn sm primary" onClick={() => setEditing({ name: '', start_time: '', end_time: '' })}>+ Add shift</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Employees on a shift get the same check-in rules as above, moved to their shift times
        {w ? <> (e.g. late allowance {w.grace - w.start} min after the start, check-in closes {w.close - w.start} min after, second half {Math.round((w.second - w.start) / 6) / 10} h after)</> : null}.
        Everyone not on a shift follows the office timing.
      </p>
      {error ? <ErrorBox message={error} onRetry={reload} /> : (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Shift</th><th>Timing</th><th>Check-in by</th><th>Check out by</th><th className="n">Employees</th><th /></tr></thead>
            <tbody>
              {shifts.map(s => {
                const sw = windows(settings, s);
                return (
                  <tr key={s.id}>
                    <td><b>{s.name}</b></td>
                    <td>{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</td>
                    <td className="muted small">{sw ? `${fmtTime(sw.start)} (late till ${fmtTime(sw.grace)}, closes ${fmtTime(sw.close)})` : '—'}</td>
                    <td className="muted small">{sw?.checkoutBy != null ? fmtTime(sw.checkoutBy) : '—'}</td>
                    <td className="n">{countOf(s.id)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn sm" onClick={() => setAssigning(s)}>Employees</button>{' '}
                      <button type="button" className="btn sm" onClick={() => setEditing(s)}>Edit</button>{' '}
                      <button type="button" className="btn sm danger" onClick={() => remove(s)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
              {!shifts.length && !loading && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 22 }}>No shifts yet — everyone follows the office timing.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ShiftEditor shift={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {assigning && <AssignEmployees shift={assigning} shifts={shifts} emps={emps} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); reload(); }} />}
    </div>
  );
}

function ShiftEditor({ shift, onClose, onSaved }: { shift: Partial<Shift>; onClose: () => void; onSaved: () => void }) {
  const { notify } = useApp();
  const [name, setName] = useState(shift.name ?? '');
  const [start, setStart] = useState((shift.start_time ?? '').slice(0, 5));
  const [end, setEnd] = useState((shift.end_time ?? '').slice(0, 5));
  const [busy, setBusy] = useState(false);

  async function save() {
    const a = toMinutes(start), b = toMinutes(end);
    if (!name.trim()) { notify('Give the shift a name.', 'err'); return; }
    if (a == null || b == null) { notify('Pick the start and end time.', 'err'); return; }
    if (b <= a) { notify('The shift must end after it starts, on the same day.', 'err'); return; }
    setBusy(true);
    const row = { name: name.trim(), start_time: start, end_time: end };
    const sb = supabaseBrowser();
    const { error } = shift.id ? await sb.from('shifts').update(row).eq('id', shift.id) : await sb.from('shifts').insert(row);
    setBusy(false);
    if (error) { notify(error.message, 'err'); return; }
    notify('Shift saved');
    onSaved();
  }

  return (
    <Modal title={shift.id ? `Edit ${shift.name}` : 'Add shift'} onClose={onClose}>
      <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <label className="wide">Shift name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Evening shift" /></label>
        <div className="lbl">Starts at<TimePicker value={start} onChange={setStart} /></div>
        <div className="lbl">Ends at<TimePicker value={end} onChange={setEnd} /></div>
      </div>
      <div className="row" style={{ marginTop: 16, marginBottom: 0, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save shift'}</button>
      </div>
    </Modal>
  );
}

function AssignEmployees({ shift, shifts, emps, onClose, onSaved }: {
  shift: Shift; shifts: Shift[]; emps: Emp[]; onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useApp();
  const [on, setOn] = useState(() => new Set(emps.filter(e => e.shift_id === shift.id).map(e => e.id)));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const nameOf = useMemo(() => new Map(shifts.map(s => [s.id, s.name])), [shifts]);
  const list = emps.filter(e => !q.trim() || [e.name, e.emp_code, e.department].some(x => (x ?? '').toLowerCase().includes(q.trim().toLowerCase())));
  const toggle = (id: string) => setOn(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save() {
    const add = emps.filter(e => on.has(e.id) && e.shift_id !== shift.id).map(e => e.id);
    const drop = emps.filter(e => !on.has(e.id) && e.shift_id === shift.id).map(e => e.id);
    setBusy(true);
    const sb = supabaseBrowser();
    for (const [ids, value] of [[add, shift.id], [drop, null]] as [string[], string | null][]) {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from('employees').update({ shift_id: value }).in('id', ids.slice(i, i + 200));
        if (error) { setBusy(false); notify(error.message, 'err'); return; }
      }
    }
    setBusy(false);
    notify(`${shift.name}: ${on.size} employee(s)`);
    onSaved();
  }

  return (
    <Modal title={`Employees on ${shift.name} (${fmtTime(shift.start_time)} – ${fmtTime(shift.end_time)})`} onClose={onClose}>
      <input placeholder="Search name, ID, department" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      <div className="shift-list">
        {list.map(e => (
          <label key={e.id} className="shift-row">
            <input type="checkbox" checked={on.has(e.id)} onChange={() => toggle(e.id)} />
            <span><b>{e.name}</b> <span className="muted small">{e.emp_code}{e.department ? ` · ${e.department}` : ''}</span></span>
            {e.shift_id && e.shift_id !== shift.id && <span className="pill gray">now: {nameOf.get(e.shift_id) ?? 'other shift'}</span>}
          </label>
        ))}
        {!list.length && <div className="muted small" style={{ padding: 12 }}>No one matches.</div>}
      </div>
      <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
        <span className="muted small">{on.size} selected. Ticking someone on another shift moves them here.</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}
