import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { AppProvider } from '@/components/AppContext';
import { Shell } from '@/components/Shell';
import { mailConfigured } from '@/lib/mailer';
import { driveConfigured } from '@/lib/drive';
import { isStaff, type Profile, type Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile || !profile.active) redirect('/api/logout');
  if (profile.must_change_password) redirect('/change-password');
  if (!isStaff((profile as Profile).role)) redirect('/portal');

  const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (!settings) throw new Error('Settings row missing. Did you run supabase/schema.sql?');

  return (
    <AppProvider profile={profile as Profile} settings={settings as Settings} mailReady={mailConfigured()} driveReady={driveConfigured()}>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
