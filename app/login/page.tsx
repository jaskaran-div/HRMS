import { supabaseAdmin } from '@/lib/supabase/admin';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

/** The login screen shows the company's own name and logo (read on the server; nothing else is exposed). */
export default async function LoginPage() {
  let brand = { name: 'HR Portal', logo: null as string | null };
  try {
    const { data } = await supabaseAdmin().from('settings').select('company_name, logo').eq('id', 1).maybeSingle();
    if (data) brand = { name: data.company_name || brand.name, logo: data.logo ?? null };
  } catch { /* the form still works without branding */ }
  return <LoginForm company={brand.name} logo={brand.logo} />;
}
