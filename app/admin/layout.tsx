import { requirePlatformAdmin } from '@/lib/platform';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { liveMode, stripeConfigProblems } from '@/lib/stripe';
import { platformName } from '@/lib/platform-mail';
import { AdminShell } from './AdminNav';

export const dynamic = 'force-dynamic';

/** Platform super admin panel (the SaaS operator). Not part of any organization; 404 for everyone else. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  const { data: p } = await supabaseAdmin().from('profiles').select('full_name, email').eq('id', user.id).maybeSingle();
  const problems = stripeConfigProblems();
  const name = p?.full_name || user.email?.split('@')[0] || 'Admin';
  return (
    <AdminShell
      platform={platformName()}
      user={{ name, email: p?.email || user.email || '' }}
      stripe={{ label: problems.length ? 'not set up' : liveMode() ? 'live' : 'test mode', tone: problems.length ? 'gray' : liveMode() ? 'ok' : 'warn', problems }}
    >
      {children}
    </AdminShell>
  );
}
