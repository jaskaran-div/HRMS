import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { AppProvider } from '@/components/AppContext';
import { Shell } from '@/components/Shell';
import { mailConfigured } from '@/lib/mailer';
import { driveConfigured } from '@/lib/drive';
import { requireAccess, webSession } from '@/lib/web-session';
import { summarize } from '@/lib/org';
import { isStaff, type Settings } from '@/lib/types';
import { AppDownloadFab } from '@/components/AppDownloadFab';
import { androidApp } from '@/lib/mobile-app';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await webSession();
  await requireAccess(s);
  const { profile, org } = s;
  if (profile.must_change_password) redirect('/change-password');
  // a new organization's owner sets it up once, right after the first payment
  if (!org.onboarded_at && profile.role === 'owner') redirect('/onboarding');
  if (!isStaff(profile.role)) redirect('/portal');

  // read as the user: Row Level Security returns only this organization's row
  const supabase = await supabaseServer();
  const { data: settings } = await supabase.from('settings').select('*').eq('org_id', org.id).single();
  if (!settings) throw new Error('Settings row missing. Did you run supabase/saas.sql?');
  const app = await androidApp();

  return (
    <AppProvider profile={profile} settings={settings as Settings} org={summarize(org)} mailReady={mailConfigured()} driveReady={driveConfigured()}>
      <Shell>{children}</Shell>
      {app.available && <AppDownloadFab store={app.kind === 'store'} />}
    </AppProvider>
  );
}
