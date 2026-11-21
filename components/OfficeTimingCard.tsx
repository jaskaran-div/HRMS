'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from './AppContext';
import { Modal } from './Modal';
import { TimePicker } from './TimePicker';
import { ErrorBox } from './ui';
import { ask } from './Dialog';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useLoad } from '@/lib/use-load';
import { fetchAll } from '@/lib/fetch-all';
import { num } from '@/lib/format';
import { fmtTime, toMinutes, windows } from '@/lib/late';
import type { Employee, Settings, Shift, ShiftRules } from '@/lib/types';

type Emp = Pick<Employee, 'id' | 'shift_id'>;

/** The timing form (strings, as typed). office_start_time = check in by; office_end_time = the shift's end on a shift tab. */
interface TF {
  office_start_time: string; late_grace_until: string; late_allowed_per_month: string; checkin_close_time: string;
  second_half_start: string; morning_short_back: string; office_end_time: string; checkout_by: string; checkin_extra_min: string;
}

const NO_SHIFT = 'none';
const hm = (t: string | null | undefined) => (t ?? '').slice(0, 5);

function formOf(r: Partial<Settings> | ShiftRules | null | undefined, end: string | null | undefined): TF {
  return {
    office_start_time: hm(r?.office_start_time), late_grace_until: hm(r?.late_grace_until),
    late_allowed_per_month: String(r?.late_allowed_per_month ?? 3),
    checkin_close_time: hm(r?.checkin_close_time ?? '11:00'), second_half_start: hm(r?.second_half_start ?? '14:00'),
    morning_short_back: hm(r?.morning_short_back ?? '12:30'), office_end_time: hm(end ?? '19:00'), checkout_by: hm(r?.checkout_by),
    checkin_extra_min: String(r?.checkin_extra_min ?? 60),
  };
}

/** The rules as saved (null where a time is not set), or an error message. */
function rulesOf(f: TF): { ok: true; rules: Required<ShiftRules>; end: string | null } | { ok: false; error: string } {
  const start = toMinutes(f.office_start_time), grace = toMinutes(f.late_grace_until);
  const lateAllowed = Math.round(num(f.late_allowed_per_month));
  const close = toMinutes(f.checkin_close_time), second = toMinutes(f.second_half_start), shortBack = toMinutes(f.morning_short_back);
  const end = toMinutes(f.office_end_time), outBy = toMinutes(f.checkout_by);
  const extra = Math.round(num(f.checkin_extra_min));
  const bad = (error: string) => ({ ok: false as const, error });
  if (f.office_start_time && start == null) return bad('Pick a valid check-in-by time.');
  if (lateAllowed < 0 || lateAllowed > 31) return bad('Late check-ins allowed per month must be between 0 and 31.');
  if (extra < 0 || extra > 240) return bad('The check-in allowance must be between 0 and 240 minutes.');
  if (start != null) {
    if (grace == null) return bad('Pick the late allowance time.');
    if (grace < start) return bad('The late allowance time cannot be before the check-in-by time.');
    if (close == null || second == null || shortBack == null || end == null) return bad('Pick all the office timing times.');
    if (close < grace) return bad('Morning check-in cannot close before the late allowance time.');
    if (second < close) return bad('The second half cannot start before morning check-in closes.');
    if (shortBack < start) return bad('The morning short leave return time cannot be before the check-in-by time.');
    if (end <= start) return bad('The office end time must be after the check-in-by time.');
    if (outBy != null && outBy < end) return bad('"Check out by" cannot be before the office end time.');
  }
  const t = (v: string, m: number | null) => (start != null && m != null ? v : null);
  return {
    ok: true,
    rules: {
      office_start_time: start != null ? f.office_start_time : null, late_grace_until: t(f.late_grace_until, grace),
      late_allowed_per_month: lateAllowed, checkin_close_time: t(f.checkin_close_time, close),
      second_half_start: t(f.second_half_start, second), morning_short_back: t(f.morning_short_back, shortBack),
      checkin_extra_min: extra, checkout_by: t(f.checkout_by, outBy),
    },
    end: end != null ? f.office_end_time : null,
  };
}

/** A copy of `r` with every time moved by `d` minutes (a new shift starts from the nearest shift's timing). */
function moved(r: ShiftRules, d: number): ShiftRules {
  const mv = (t: string | null | undefined) => {
    const m = toMinutes(t);
    if (m == null) return t ?? null;
    const v = Math.min(23 * 60 + 59, Math.max(0, m + d));
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  };
  return {
    ...r, office_start_time: mv(r.office_start_time), late_grace_until: mv(r.late_grace_until), checkin_close_time: mv(r.checkin_close_time),
    second_half_start: mv(r.second_half_start), morning_short_back: mv(r.morning_short_back), checkout_by: mv(r.checkout_by),
  };
}

/**
 * Company & Rules → Office timing. One tab per shift (each with its own check-in / check-out rules) plus "No shift" for
 * employees not on a shift (the company timing). With no shifts there are no tabs: everyone follows the company timing.
 */
export function OfficeTimingCard() {
  const { settings, notify } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TF>>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Partial<Shift> | null>(null);
  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [{ data: shifts, error: e1 }, emps] = await Promise.all([
      sb.from('shifts').select('*').order('start_time'),
      fetchAll<Emp>((a, b) => sb.from('employees').select('id, shift_id').is('archived_at', null).range(a, b)),
    ]);
    if (e1) throw new Error(e1.message);
    return { shifts: (shifts ?? []) as Shift[], emps };
  }, []);
  const shifts = data?.shifts ?? [];
  const emps = data?.emps ?? [];
  const countOf = (id: string | null) => emps.filter(e => (e.shift_id ?? null) === id).length;

  const cur = tab && (tab === NO_SHIFT || shifts.some(s => s.id === tab)) ? tab : (shifts[0]?.id ?? NO_SHIFT);
  const shift = shifts.find(s => s.id === cur) ?? null;
  const saved = (): TF => (shift ? formOf(shift.rules ?? settings, shift.end_time) : formOf(settings, settings.office_end_time));
  const f = drafts[cur] ?? saved();
  const setF = (patch: Partial<TF>) => setDrafts(d => ({ ...d, [cur]: { ...f, ...patch } }));
  const set = (k: keyof TF) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ [k]: e.target.value });
  const off = !f.office_start_time;

  async function save() {
    const r = rulesOf(f);
    if (!r.ok) { notify(r.error, 'err'); return; }
    const sb = supabaseBrowser();
    setBusy(true);
    let err: string | undefined;
    if (shift) {
      if (r.end == null) { setBusy(false); notify('Pick the shift end time.', 'err'); return; }
      if (toMinutes(r.end)! <= toMinutes(shift.start_time)!) { setBusy(false); notify(`The office end time must be after the shift start (${fmtTime(shift.start_time)}).`, 'err'); return; }
      const { error } = await sb.from('shifts').update({ rules: r.rules, end_time: r.end }).eq('id', shift.id);
      err = error?.message;
    } else {
      const { error } = await sb.from('settings').update({ ...r.rules, office_end_time: r.end }).eq('id', settings.id);
      err = error?.message;
    }
    setBusy(false);
    if (err) { notify(err, 'err'); return; }
    notify(shift ? `${shift.name} timing saved` : 'Saved');
    setDrafts(d => { const { [cur]: _, ...rest } = d; return rest; });
    if (shift) reload(); else router.refresh();
  }

  async function remove(s: Shift) {
    const n = countOf(s.id);
    if (!(await ask.confirm({
      title: `Delete the ${s.name} shift?`, confirmText: 'Delete', danger: true,
      message: n ? `${n} employee(s) on it go to "No shift" (the company office timing).` : undefined,
    }))) return;
    const { error } = await supabaseBrowser().from('shifts').delete().eq('id', s.id);
    if (error) { notify(error.message, 'err'); return; }
    notify('Shift deleted');
    setTab(null);
    reload();
  }

  const r = rulesOf(f);
  const w = r.ok ? windows({ ...r.rules, office_end_time: r.end }) : null;
  const n = w?.allowed ?? 0;
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Office timing (check-in)</h3>
        <span className="sp" style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={() => setEditing({ name: '', start_time: '', end_time: '' })}>+ Add shift</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Applied automatically when an employee checks in from the mobile app. Anyone who has not checked in when the second-half
        window closes is marked <b>Absent</b> (week offs, approved full-day leave and days HR already marked, e.g. a holiday, are skipped).
        {shifts.length > 0 && <> Each shift has its own timing; pick an employee&apos;s shift on their page under <b>Edit details → Shift</b>.</>}
      </p>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <p className="muted small">Loading…</p> : <>
        {shifts.length > 0 && (
          <div className="tabs" style={{ marginTop: 4, marginBottom: 14 }}>
            {shifts.map(s => (
              <button key={s.id} type="button" className={cur === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>
                {s.name}{drafts[s.id] ? ' •' : ''}
              </button>
            ))}
            <button type="button" className={cur === NO_SHIFT ? 'on' : ''} onClick={() => setTab(NO_SHIFT)}>No shift{drafts[NO_SHIFT] ? ' •' : ''}</button>
          </div>
        )}
        {shift ? (
          <div className="row" style={{ marginTop: 0, marginBottom: 12 }}>
            <span className="muted small">
              <b>{shift.name}</b>: {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)} · {countOf(shift.id)} employee{countOf(shift.id) === 1 ? '' : 's'}
              {!shift.rules && <> · uses the &quot;No shift&quot; timing until saved here</>}
            </span>
            <span className="sp" style={{ flex: 1 }} />
            <button type="button" className="btn sm" onClick={() => setEditing(shift)}>Rename / times</button>
            <button type="button" className="btn sm danger" onClick={() => remove(shift)}>Delete shift</button>
          </div>
        ) : shifts.length > 0 ? (
          <p className="muted small" style={{ marginTop: 0 }}>For the {countOf(null)} employee{countOf(null) === 1 ? '' : 's'} not on a shift.</p>
        ) : null}
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <div className="lbl">Check in by
            <TimePicker value={f.office_start_time} clearable placeholder="No timing rule" onChange={v => setF({ office_start_time: v, late_grace_until: v && !f.late_grace_until ? v : f.late_grace_until })} />
            <span className="hint">Checked in by this time = Present. Clear it to turn all of this off.</span>
          </div>
          <div className="lbl">Late allowance until
            <TimePicker value={f.late_grace_until} disabled={off} onChange={v => setF({ late_grace_until: v })} />
            <span className="hint">After the check-in-by time and up to this = late.</span>
          </div>
          <label>Late check-ins allowed per month
            <input type="number" min={0} max={31} step={1} value={f.late_allowed_per_month} onChange={set('late_allowed_per_month')} disabled={off} />
            <span className="hint">These late check-ins still count as Present; late check-ins beyond them are half days.</span>
          </label>
          <div className="lbl">Morning check-in closes at
            <TimePicker value={f.checkin_close_time} disabled={off} onChange={v => setF({ checkin_close_time: v })} />
            <span className="hint">After the late allowance time and up to this = Half day.</span>
          </div>
          <div className="lbl">Second half starts at
            <TimePicker value={f.second_half_start} disabled={off} onChange={v => setF({ second_half_start: v })} />
            <span className="hint">Check-in reopens for a half day; a morning half day ends here.</span>
          </div>
          <div className="lbl">Morning short leave: back by
            <TimePicker value={f.morning_short_back} disabled={off} onChange={v => setF({ morning_short_back: v })} />
            <span className="hint">When an employee on a morning short leave is due.</span>
          </div>
          <div className="lbl">Office end time
            <TimePicker value={f.office_end_time} disabled={off && !shift} onChange={v => setF({ office_end_time: v })} />
            <span className="hint">{shift ? 'The shift end.' : 'The regular end of the day.'}</span>
          </div>
          <div className="lbl">Check out by
            <TimePicker value={f.checkout_by} clearable placeholder="Check-out not required" disabled={off} onChange={v => setF({ checkout_by: v })} />
            <span className="hint">Check-out is mandatory and allowed until this. Not checked out by then = Half day.</span>
          </div>
          <label>Extra check-in allowance (minutes)
            <input type="number" min={0} max={240} step={5} value={f.checkin_extra_min} onChange={set('checkin_extra_min')} disabled={off} />
            <span className="hint">Added after the second half start and the short leave return time.</span>
          </label>
        </div>
        {w && (
          <div className="rule-sum">
            <div><span className="t">By {fmtTime(w.start)}</span><span className="pill ok">Present</span></div>
            {w.grace > w.start && <div><span className="t">{fmtTime(w.start + 1)} – {fmtTime(w.grace)}</span>
              {n > 0 ? <><span className="pill warn">Present (late)</span><span className="muted small">first {n} time{n > 1 ? 's' : ''} a month, then</span></> : null}
              <span className="pill bad">Half day</span></div>}
            {w.close > w.grace && <div><span className="t">{fmtTime(w.grace)} – {fmtTime(w.close)}</span><span className="pill bad">Half day</span></div>}
            {w.second > w.close && <div><span className="t">{fmtTime(w.close)} – {fmtTime(w.second)}</span><span className="pill gray">Check-in closed</span></div>}
            <div><span className="t">{fmtTime(w.second)} – {fmtTime(w.deadline)}</span><span className="pill bad">Half day</span><span className="muted small">second half</span></div>
            <div><span className="t">Not checked in by {fmtTime(w.deadline)}</span><span className="pill bad">Absent</span></div>
            <div><span className="t">Morning short leave</span><span className="pill blue">Short leave</span><span className="muted small">if checked in by {fmtTime(w.shortUntil)}</span></div>
            <div><span className="t">Morning half day</span><span className="pill bad">Half day</span><span className="muted small">if checked in by {fmtTime(w.deadline)}</span></div>
            {w.checkoutBy != null && <div><span className="t">Not checked out by {fmtTime(w.checkoutBy)}</span><span className="pill bad">Half day</span><span className="muted small">check-out closes then</span></div>}
          </div>
        )}
        <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : shift ? `Save ${shift.name} timing` : 'Save'}</button>
          {drafts[cur] && <button type="button" className="btn" onClick={() => setDrafts(d => { const { [cur]: _, ...rest } = d; return rest; })}>Discard changes</button>}
        </div>
      </>}
      {editing && (
        <ShiftEditor shift={editing} template={shifts} fallback={settings} onClose={() => setEditing(null)}
          onSaved={id => { setEditing(null); if (id) setTab(id); reload(); }} />
      )}
    </div>
  );
}

/** Name, start and end of a shift. A new shift starts with the nearest existing shift's timing, moved to its start. */
function ShiftEditor({ shift, template, fallback, onClose, onSaved }: {
  shift: Partial<Shift>; template: Shift[]; fallback: Settings; onClose: () => void; onSaved: (id?: string) => void;
}) {
  const { notify } = useApp();
  const [name, setName] = useState(shift.name ?? '');
  const [start, setStart] = useState(hm(shift.start_time));
  const [end, setEnd] = useState(hm(shift.end_time));
  const [busy, setBusy] = useState(false);

  async function save() {
    const a = toMinutes(start), b = toMinutes(end);
    if (!name.trim()) { notify('Give the shift a name.', 'err'); return; }
    if (a == null || b == null) { notify('Pick the start and end time.', 'err'); return; }
    if (b <= a) { notify('The shift must end after it starts, on the same day.', 'err'); return; }
    const row: Partial<Shift> = { name: name.trim(), start_time: start, end_time: end };
    if (!shift.id) {
      const near = template.filter(s => s.rules).sort((x, y) => Math.abs(toMinutes(x.start_time)! - a) - Math.abs(toMinutes(y.start_time)! - a))[0];
      const base = near?.rules ?? formRules(fallback);
      row.rules = moved(base, near ? a - toMinutes(near.start_time)! : 0);
      // check out by keeps its distance after the end
      const outBy = toMinutes(base.checkout_by), baseEnd = toMinutes(near ? near.end_time : fallback.office_end_time);
      if (outBy != null && baseEnd != null) row.rules = { ...row.rules, checkout_by: moved({ checkout_by: end }, Math.max(0, outBy - baseEnd)).checkout_by };
    }
    setBusy(true);
    const sb = supabaseBrowser();
    const { data, error } = shift.id
      ? await sb.from('shifts').update(row).eq('id', shift.id).select('id').single()
      : await sb.from('shifts').insert(row).select('id').single();
    setBusy(false);
    if (error) { notify(error.message, 'err'); return; }
    notify(shift.id ? 'Shift saved' : 'Shift added — check its timing below, then save');
    onSaved(data?.id as string | undefined);
  }

  return (
    <Modal title={shift.id ? `Edit ${shift.name}` : 'Add shift'} onClose={onClose}>
      <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <label className="wide">Shift name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Evening" /></label>
        <div className="lbl">Starts at<TimePicker value={start} onChange={setStart} /></div>
        <div className="lbl">Ends at<TimePicker value={end} onChange={setEnd} /></div>
      </div>
      {!shift.id && <p className="muted small">Its check-in timing starts as a copy of the nearest shift&apos;s, moved to this start time. Adjust it in the shift&apos;s tab.</p>}
      <div className="row" style={{ marginTop: 16, marginBottom: 0, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save shift'}</button>
      </div>
    </Modal>
  );
}

function formRules(s: Settings): ShiftRules {
  return {
    office_start_time: s.office_start_time ?? null, late_grace_until: s.late_grace_until ?? null, late_allowed_per_month: s.late_allowed_per_month ?? 3,
    checkin_close_time: s.checkin_close_time ?? null, second_half_start: s.second_half_start ?? null, morning_short_back: s.morning_short_back ?? null,
    checkin_extra_min: s.checkin_extra_min ?? 60, checkout_by: s.checkout_by ?? null,
  };
}
