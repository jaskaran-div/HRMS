import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { AppProvider } from '@/components/AppContext';
import { Shell } from '@/components/Shell';
import type { Profile, Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile || !profile.active) redirect('/api/logout');
  if (profile.must_change_password) redirect('/change-password');

  const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (!settings) throw new Error('Settings row missing. Did you run supabase/schema.sql?');

  return (
    <AppProvider profile={profile as Profile} settings={settings as Settings}>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
