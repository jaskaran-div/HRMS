'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../AppContext';
import { LeaveStatus } from '../LeaveStatus';
import { fmtDate, monthLabel } from '@/lib/dates';
import { availableTypes, LEAVE_TYPES, leaveLabel, quotaFor, validateLeave } from '@/lib/leave';
import type { LeaveRequest, LeaveType, Settings } from '@/lib/types';

type QuotaSettings = Pick<Settings, 'short_leave_per_month' | 'paid_leave_per_month'>;

export function LeaveCenter({ leaves, today, quota, mailReady, recipients }: {
  leaves: LeaveRequest[]; today: string; quota: QuotaSettings; mailReady: boolean; recipients: string[];
}) {
  const { notify } = useApp();
  const router = useRouter();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [type, setType] = useState<LeaveType | ''>('');
  const [reason, setReason] = useState('');
  const [sendMail, setSendMail] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const month = `${(start || today).slice(0, 7)}-01`;
  const q = useMemo(() => quotaFor(leaves, month, quota), [leaves, month, quota]);
  const options = availableTypes(q);
  const chosen: LeaveType = type && options.includes(type) ? type : options[0];
  const check = start ? validateLeave({ leave_type: chosen, start_date: start, end_date: chosen === 'short' ? start : end || start }, leaves, quota, today) : null;

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (check && !check.ok) { notify(check.error, 'err'); return; }
    setBusy('apply');
    const res = await fetch('/api/leave', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leave_type: chosen, start_date: start, end_date: chosen === 'short' ? start : end, reason, email: sendMail && mailReady }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { notify(j.error ?? 'Could not apply', 'err'); return; }
    if (j.mail && !j.mail.ok) notify(`Leave applied, but the email failed: ${j.mail.error}`, 'err');
    else notify(j.mail?.ok ? `Leave applied and emailed to ${j.mail.to.join(', ')}` : 'Leave applied');
    setReason(''); setType('');
    router.refresh();
  }

  async function act(l: LeaveRequest, action: 'cancel' | 'email') {
    if (action === 'cancel' && !confirm('Cancel this leave request?')) return;
    setBusy(l.id);
    const res = await fetch('/api/leave', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, action }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { notify(j.error ?? 'Could not do that', 'err'); return; }
    notify(action === 'email' ? `Emailed to ${(j.to as string[]).join(', ')}` : 'Cancelled');
    router.refresh();
  }

  const when = (l: LeaveRequest) => (l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`);

  return (
    <>
      <div className="card">
        <h3>Apply for leave</h3>
        <form onSubmit={apply}>
          <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            <label>{chosen === 'short' ? 'Date' : 'From'}
              <input type="date" value={start} required onChange={e => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} />
            </label>
            {chosen !== 'short' && (
              <label>To<input type="date" value={end} min={start} required onChange={e => setEnd(e.target.value)} /></label>
            )}
            <label>Leave type
              <select value={chosen} onChange={e => setType(e.target.value as LeaveType)}>
                {LEAVE_TYPES.filter(t => options.includes(t.type)).map(t => <option key={t.type} value={t.type}>
                  {t.label} — {t.type === 'paid' && q.paidLeft <= 0 ? "this month's is used, HR decides paid or absent" : t.hint}</option>)}
              </select>
              <span className="hint">
                {monthLabel(month)}: short leave {q.shortLeft}/{q.shortPerMonth} left · paid leave {q.paidLeft}/{q.paidPerMonth} left
                {!options.includes('short') && ' — short leave is used.'}
              </span>
            </label>
            <label className="wide">Reason
              <input value={reason} maxLength={1000} placeholder="e.g. Doctor's appointment" onChange={e => setReason(e.target.value)} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" disabled={busy === 'apply' || !start || (check !== null && !check.ok)}>{busy === 'apply' ? 'Applying…' : 'Apply'}</button>
            {check && (check.ok
              ? <span className={check.overQuota ? 'small' : 'muted small'}>{chosen === 'short' ? 'Short leave on 1 day' : `${check.days} working day(s)`} (week offs not counted)
                  {check.overQuota && <> · <b>over this month&apos;s paid leave</b>: HR will decide if it is paid or counted as absent — give a clear reason.</>}</span>
              : <span className="err small">{check.error}</span>)}
            <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={sendMail && mailReady} disabled={!mailReady || !recipients.length} onChange={e => setSendMail(e.target.checked)} />
              {mailReady
                ? recipients.length ? `Email it to ${recipients.join(' and ')}` : 'No team leader / HR email set up yet'
                : 'Email is not set up yet — HR will still see it in the portal'}
            </label>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>My leave history</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Type</th><th>Date(s)</th><th className="n">Days</th><th>Reason</th><th>Status</th><th>Applied</th><th /></tr></thead>
            <tbody>
              {leaves.map(l => (
                <tr key={l.id}>
                  <td>{leaveLabel(l.leave_type)}</td><td>{when(l)}</td><td className="n">{l.days}</td>
                  <td>{l.reason || <span className="muted">—</span>}</td>
                  <td><LeaveStatus l={l} /></td>
                  <td className="muted small">{fmtDate(l.created_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {l.status === 'pending' && <>
                      {mailReady && <button className="btn sm" disabled={busy === l.id} onClick={() => act(l, 'email')}>{l.emailed_at ? 'Email again' : 'Send email'}</button>}{' '}
                      <button className="btn sm danger" disabled={busy === l.id} onClick={() => act(l, 'cancel')}>Cancel</button>
                    </>}
                  </td>
                </tr>
              ))}
              {!leaves.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 26 }}>No leave in the last 12 months.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
