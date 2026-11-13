import { redirect } from 'next/navigation';
import { AppProvider } from '@/components/AppContext';
import { PortalShell } from '@/components/portal/PortalShell';
import { Empty } from '@/components/ui';
import { myTeam, portalSession } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isStaff } from '@/lib/types';
import { summarize } from '@/lib/org';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await portalSession();
  if (!s.me && isStaff(s.profile.role)) redirect('/');
  let pending = 0;
  if (s.isLead) {
    const team = await myTeam(s);
    if (team.length) {
      const { count } = await supabaseAdmin().from('leave_requests').select('id', { count: 'exact', head: true })
        .in('employee_id', team.map(t => t.id)).eq('status', 'pending').eq('tl_status', 'pending');
      pending = count ?? 0;
    }
  }
  return (
    <AppProvider profile={s.profile} settings={s.settings} org={summarize(s.org)}>
      <PortalShell isLead={s.isLead} isStaff={isStaff(s.profile.role)} pending={pending} name={s.me?.name ?? s.profile.full_name}>
        {s.me ? children : (
          <div className="card"><Empty icon="lock" title="Your login is not linked to an employee yet">Ask HR to link it under User Access.</Empty></div>
        )}
      </PortalShell>
    </AppProvider>
  );
}
