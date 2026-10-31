// Creates the FIRST admin login (HR). Run once after setting up .env.local:
//   npm run create-admin -- hr "HR Admin"
// Password follows the house rule: username "hr" -> "Hr@isft" (you will be asked to change it at first login).
import { createClient } from '@supabase/supabase-js';

const [, , usernameArg, ...nameParts] = process.argv;
const username = (usernameArg ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fullName = nameParts.join(' ').trim() || username;
if (username.length < 2) {
  console.error('Usage: npm run create-admin -- <username> "<Full Name>"');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
  process.exit(1);
}

const domain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || 'derivion.in';
const password = username.charAt(0).toUpperCase() + username.slice(1) + '@isft';
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data, error } = await admin.auth.admin.createUser({
  email: `${username}@${domain}`,
  password,
  email_confirm: true,
  user_metadata: { username, full_name: fullName },
});
if (error) {
  console.error('Could not create the login:', error.message);
  process.exit(1);
}
const { error: pErr } = await admin.from('profiles').insert({
  id: data.user.id, username, full_name: fullName, role: 'admin', must_change_password: true,
});
if (pErr) {
  await admin.auth.admin.deleteUser(data.user.id);
  console.error('Could not save the profile (did you run supabase/schema.sql?):', pErr.message);
  process.exit(1);
}
console.log(`Admin created.\n  username: ${username}\n  password: ${password}  (must be changed at first login)`);
