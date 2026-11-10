// Creates (or repairs) an admin login (HR). Run after setting up .env.local:
//   npm run create-admin -- hr "HR Admin"
//     password follows the house rule: "hr" -> "Hr@isft", and must be changed at first login
//   npm run create-admin -- admin "Test Admin" --password admin@123 --no-change
//     a fixed password, no forced change (for testing only — change or disable it before real use)
// If the username already exists, its password and admin role are (re)set instead.
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, name.startsWith('--no-') ? 1 : 2).slice(1)[0] ?? true : undefined; };
const pwArg = flag('--password');
const noChange = flag('--no-change') !== undefined;
const [usernameArg, ...nameParts] = args;
const username = (usernameArg ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fullName = nameParts.join(' ').trim() || username;
if (username.length < 2) {
  console.error('Usage: npm run create-admin -- <username> "<Full Name>" [--password <pw>] [--no-change]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
  process.exit(1);
}

const domain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || 'derivion.in';
const password = typeof pwArg === 'string' ? pwArg : username.charAt(0).toUpperCase() + username.slice(1) + '@isft';
if (password.length < 6) { console.error('Password must be at least 6 characters.'); process.exit(1); }
const must = !noChange;
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: existing } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, { password, ban_duration: 'none' });
  if (error) { console.error('Could not update the login:', error.message); process.exit(1); }
  const { error: pErr } = await admin.from('profiles').update({ role: 'admin', active: true, must_change_password: must }).eq('id', existing.id);
  if (pErr) { console.error('Could not update the profile:', pErr.message); process.exit(1); }
  console.log(`Admin "${username}" already existed: password reset and admin access set.\n  username: ${username}\n  password: ${password}${must ? '  (must be changed at first login)' : ''}`);
  process.exit(0);
}

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
  id: data.user.id, username, full_name: fullName, role: 'admin', must_change_password: must,
});
if (pErr) {
  await admin.auth.admin.deleteUser(data.user.id);
  console.error('Could not save the profile (did you run supabase/schema.sql?):', pErr.message);
  process.exit(1);
}
console.log(`Admin created.\n  username: ${username}\n  password: ${password}${must ? '  (must be changed at first login)' : ''}`);
