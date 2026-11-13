// Grants platform super admin (the /admin panel) to an existing login. Run on the server:
//   node --env-file=.env.local scripts/make-platform-admin.mjs someone@example.com      (email or username)
//   node --env-file=.env.local scripts/make-platform-admin.mjs someone@example.com --revoke
// This is the ONLY way to create a platform admin: organization owners / admins can never grant it.
import { createClient } from '@supabase/supabase-js';

const [who, flag] = process.argv.slice(2);
if (!who) { console.error('Usage: make-platform-admin.mjs <email-or-username> [--revoke]'); process.exit(1); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const domain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || 'derivion.in';
const email = (who.includes('@') ? who : `${who.toLowerCase().replace(/[^a-z0-9]/g, '')}@${domain}`).toLowerCase();

let user = null;
for (let page = 1; !user && page < 100; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error(error.message); process.exit(1); }
  user = data.users.find(u => (u.email ?? '').toLowerCase() === email) ?? null;
  if (data.users.length < 1000) break;
}
if (!user) { console.error(`No login with email ${email}`); process.exit(1); }
const { error } = flag === '--revoke'
  ? await sb.from('platform_admins').delete().eq('user_id', user.id)
  : await sb.from('platform_admins').upsert({ user_id: user.id });
if (error) { console.error(error.message); process.exit(1); }
console.log(`${flag === '--revoke' ? 'Revoked' : 'Granted'} platform admin for ${email}`);
