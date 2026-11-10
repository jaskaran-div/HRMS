import { redirect } from 'next/navigation';
import { myTeam, portalSession } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { shiftMonth, todayISO } from '@/lib/dates';
import { TeamLeaves, type TeamLeave } from '@/components/portal/TeamLeaves';
import type { LeaveRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function Approvals() {
  const s = await portalSession();
  if (!s.isLead) redirect('/portal');
  const team = await myTeam(s);
  const by = new Map(team.map(t => [t.id, t]));
  const since = shiftMonth(`${todayISO().slice(0, 7)}-01`, -3);
  const { data } = team.length
    ? await supabaseAdmin().from('leave_requests').select('*').in('employee_id', team.map(t => t.id))
      .or(`status.eq.pending,end_date.gte.${since}`).order('start_date', { ascending: false })
    : { data: [] };
  const rows: TeamLeave[] = ((data ?? []) as LeaveRequest[]).map(l => ({ ...l, name: by.get(l.employee_id)?.name ?? '', emp_code: by.get(l.employee_id)?.emp_code ?? '' }));
  const mine = rows.filter(r => r.status === 'pending' && r.tl_status === 'pending');
  const hrOnly = rows.filter(r => r.status === 'pending' && r.tl_status !== 'pending');
  return (
    <>
      <div className="card">
        <h3>Waiting for your decision ({mine.length})</h3>
        <TeamLeaves rows={mine} />
      </div>
      {hrOnly.length > 0 && (
        <div className="card">
          <h3>Done by you · waiting for HR ({hrOnly.length})</h3>
          <TeamLeaves rows={hrOnly} />
        </div>
      )}
      <div className="card">
        <h3>Team leave · last 3 months</h3>
        <TeamLeaves rows={rows.filter(r => r.status !== 'pending')} />
        <p className="muted small">Leave needs your approval and HR&apos;s (in any order); a decline from either declines it. You can change your decision later. The employee is emailed once the outcome is final.</p>
      </div>
    </>
  );
}
