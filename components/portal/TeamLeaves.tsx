'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../AppContext';
import { LeaveStatus } from '../LeaveStatus';
import { fmtDate } from '@/lib/dates';
import { leaveLabel } from '@/lib/leave';
import type { LeaveRequest } from '@/lib/types';

export type TeamLeave = LeaveRequest & { name: string; emp_code: string };

/** Team leave requests with the team leader's approve / decline (the server re-checks that the person is in the leader's team). */
export function TeamLeaves({ rows, showName = true }: { rows: TeamLeave[]; showName?: boolean }) {
  const { notify } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(l: TeamLeave, action: 'approve' | 'reject') {
    const note = prompt(action === 'reject' ? `Reason for declining ${l.name}'s leave (optional):` : `Note for ${l.name} / HR (optional):`, '');
    if (note === null) return;
    setBusy(l.id);
    const res = await fetch('/api/leave', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, action, note, as: 'tl' }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { notify(j.error ?? 'Could not save', 'err'); return; }
    notify(action === 'approve' ? `You approved ${l.name}'s leave${j.leave?.status === 'pending' ? ' · now waiting for HR' : ''}` : `You declined ${l.name}'s leave`);
    router.refresh();
  }

  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr>{showName && <th>Employee</th>}<th>Type</th><th>Date(s)</th><th className="n">Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.map(l => (
            <tr key={l.id}>
              {showName && <td><b>{l.name}</b><div className="muted small">{l.emp_code}</div></td>}
              <td>{leaveLabel(l.leave_type)}</td>
              <td>{l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`}<div className="muted small">applied {fmtDate(l.created_at)}</div></td>
              <td className="n">{l.days}</td>
              <td>{l.reason || <span className="muted">—</span>}</td>
              <td><LeaveStatus l={l} /></td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {l.status !== 'cancelled' && l.tl_status !== 'not_required' && <>
                  {l.tl_status !== 'approved' && <button className="btn sm primary" disabled={busy === l.id} onClick={() => decide(l, 'approve')}>Approve</button>}{' '}
                  {l.tl_status !== 'rejected' && <button className="btn sm danger" disabled={busy === l.id} onClick={() => decide(l, 'reject')}>Decline</button>}
                </>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 26 }}>Nothing here.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
