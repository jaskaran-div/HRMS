import { supabaseAdmin } from '@/lib/supabase/admin';
import { LoginForm } from './LoginForm';
import { AppDownloadFab } from '@/components/AppDownloadFab';
import { androidApp } from '@/lib/mobile-app';

export const dynamic = 'force-dynamic';

/**
 * One login page for every organization. It shows the name and logo of LOGIN_BRAND_ORG (an organization's slug),
 * by default the first organization (Derivion), exactly as before. LOGIN_BRAND_ORG=none shows the platform name.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string; invited?: string }> }) {
  const sp = await searchParams;
  let brand = { name: process.env.PLATFORM_NAME || 'HR Portal', logo: null as string | null };
  const slug = process.env.LOGIN_BRAND_ORG || 'derivion';
  if (slug !== 'none') try {
    const admin = supabaseAdmin();
    const { data: org, error } = await admin.from('organizations').select('id').eq('slug', slug).maybeSingle();
    // before supabase/saas.sql has run there is no organizations table: use the single settings row
    const { data } = org
      ? await admin.from('settings').select('company_name, logo').eq('org_id', org.id).maybeSingle()
      : error ? await admin.from('settings').select('company_name, logo').eq('id', 1).maybeSingle() : { data: null };
    if (data) brand = { name: data.company_name || brand.name, logo: data.logo ?? null };
  } catch { /* the form still works without branding */ }
  const notice = sp.verified ? 'Email verified. Log in to continue.' : sp.invited ? 'Your account is ready. Log in with your email and new password.' : null;
  const app = await androidApp();
  return <>
    <LoginForm company={brand.name} logo={brand.logo} notice={notice} />
    {app.available && <AppDownloadFab store={app.kind === 'store'} />}
  </>;
}
