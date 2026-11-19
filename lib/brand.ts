// SERVER ONLY. The brand shown before anyone logs in (login page, browser-tab icon).
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Name and logo of LOGIN_BRAND_ORG (an organization's slug), by default the first organization (Derivion).
 * LOGIN_BRAND_ORG=none shows the platform name with no logo.
 */
export async function loginBrand(): Promise<{ name: string; logo: string | null }> {
  const brand = { name: process.env.PLATFORM_NAME || 'HR Portal', logo: null as string | null };
  const slug = process.env.LOGIN_BRAND_ORG || 'derivion';
  if (slug === 'none') return brand;
  try {
    const admin = supabaseAdmin();
    const { data: org, error } = await admin.from('organizations').select('id').eq('slug', slug).maybeSingle();
    // before supabase/saas.sql has run there is no organizations table: use the single settings row
    const { data } = org
      ? await admin.from('settings').select('company_name, logo').eq('org_id', org.id).maybeSingle()
      : error ? await admin.from('settings').select('company_name, logo').eq('id', 1).maybeSingle() : { data: null };
    if (data) return { name: data.company_name || brand.name, logo: data.logo ?? null };
  } catch { /* fall back to the platform name */ }
  return brand;
}
