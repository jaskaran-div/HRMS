import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { defaultPassword } from '@/lib/username';
import { appUrl, emailPasswordChanged } from '@/lib/notify-mail';

export async function POST(req: Request) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || password.length < 8)
    return NextResponse.json({ error: 'Use at least 8 characters.' }, { status: 400 });
  if (password.toLowerCase() === defaultPassword(g.profile.username).toLowerCase() || /@isft$/i.test(password))
    return NextResponse.json({ error: 'That is the default password pattern. Pick something only you know.' }, { status: 400 });
  if (g.profile.username.length >= 4 && password.toLowerCase().includes(g.profile.username))
    return NextResponse.json({ error: 'Do not include your username in the password.' }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(g.user.id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await admin.from('profiles').update({ must_change_password: false }).eq('id', g.user.id);
  await admin.from('audit_log').insert({
    user_id: g.user.id, username: g.profile.username, table_name: 'users', op: 'PASSWORD_CHANGED', row_id: g.user.id,
  });
  await emailPasswordChanged(g.profile, appUrl(req)); // security notice; best effort
  return NextResponse.json({ ok: true });
}
