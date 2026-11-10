import { fmtDate } from '@/lib/dates';
import { leaveLabel, stageText, STATUS_PILL } from '@/lib/leave';
import type { LeaveRequest } from '@/lib/types';

const ICON = { pending: '⏳', approved: '✓', rejected: '✕' } as const;
const PILL = { pending: 'warn', approved: 'ok', rejected: 'bad' } as const;

function Step({ who, status, by, at, note }: { who: string; status: 'pending' | 'approved' | 'rejected'; by: string | null; at: string | null; note: string | null }) {
  const word = status === 'pending' ? 'pending' : status === 'approved' ? 'approved' : 'declined';
  return (
    <div className="small" style={{ marginTop: 3 }} title={note ?? undefined}>
      <span className={`pill ${PILL[status]}`}>{ICON[status]} {who}: {word}</span>
      {by && <span className="muted"> {by}{at ? `, ${fmtDate(at)}` : ''}</span>}
      {note && <div className="muted">“{note}”</div>}
    </div>
  );
}

/** Overall status line plus the team leader and HR steps. Works in server and client components. */
export function LeaveStatus({ l }: { l: LeaveRequest }) {
  return (
    <div>
      <span className={`pill ${STATUS_PILL[l.status]}`}>{stageText(l)}</span>
      {l.status !== 'cancelled' && (
        <>
          {l.tl_status !== 'not_required' && <Step who="Team leader" status={l.tl_status} by={l.tl_by_name} at={l.tl_at} note={l.tl_note} />}
          <Step who="HR" status={l.hr_status} by={l.hr_by_name} at={l.hr_at} note={l.hr_note} />
        </>
      )}
      {l.over_quota && l.status === 'pending' && <div className="small" style={{ marginTop: 3 }}><span className="pill warn">Over this month&apos;s paid leave — HR decides paid or absent</span></div>}
      {l.requested_type && l.requested_type !== l.leave_type && (
        <div className="small" style={{ marginTop: 3 }}>Asked for {leaveLabel(l.requested_type).toLowerCase()} · <b>counted as {leaveLabel(l.leave_type).toLowerCase()}</b></div>
      )}
      {l.emailed_to && <div className="muted small" style={{ marginTop: 3 }} title={l.emailed_to}>✉️ emailed {fmtDate(l.emailed_at)}</div>}
    </div>
  );
}
