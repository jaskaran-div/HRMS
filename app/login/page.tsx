import { supabaseAdmin } from '@/lib/supabase/admin';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

/**
 * One login page for every organization. LOGIN_BRAND_ORG (an organization's slug, e.g. "derivion") shows that
 * organization's name and logo, for a server dedicated to one company; otherwise the platform name is shown.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string; invited?: string }> }) {
  const sp = await searchParams;
  let brand = { name: process.env.PLATFORM_NAME || 'HR Portal', logo: null as string | null };
  const slug = process.env.LOGIN_BRAND_ORG;
  if (slug) try {
    const admin = supabaseAdmin();
    const { data: org } = await admin.from('organizations').select('id').eq('slug', slug).maybeSingle();
    const { data } = org ? await admin.from('settings').select('company_name, logo').eq('org_id', org.id).maybeSingle() : { data: null };
    if (data) brand = { name: data.company_name || brand.name, logo: data.logo ?? null };
  } catch { /* the form still works without branding */ }
  const notice = sp.verified ? 'Email verified. Log in to continue.' : sp.invited ? 'Your account is ready. Log in with your email and new password.' : null;
  return <LoginForm company={brand.name} logo={brand.logo} notice={notice} />;
}
