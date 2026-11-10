import { portalSession } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hrAddress } from '@/lib/leave-mail';
import { mailConfigured } from '@/lib/mailer';
import { shiftMonth, todayISO } from '@/lib/dates';
import { LeaveCenter } from '@/components/portal/LeaveCenter';
import type { LeaveRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Leave history is shown for the last 12 months (and anything ahead). */
export default async function LeavePage() {
  const s = await portalSession();
  const since = shiftMonth(`${todayISO().slice(0, 7)}-01`, -12);
  const { data } = await supabaseAdmin().from('leave_requests').select('*').eq('employee_id', s.me!.id)
    .gte('end_date', since).order('start_date', { ascending: false });
  const recipients = [s.lead?.email ? `${s.lead.name} (team leader)` : null, hrAddress(s.settings) ? 'HR' : null].filter(Boolean) as string[];
  return (
    <LeaveCenter
      leaves={(data ?? []) as LeaveRequest[]} today={todayISO()} mailReady={mailConfigured()} recipients={recipients}
      quota={{ short_leave_per_month: s.settings.short_leave_per_month, paid_leave_per_month: s.settings.paid_leave_per_month }}
    />
  );
}
