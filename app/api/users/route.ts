import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cleanUsername, defaultPassword, toEmail } from '@/lib/username';
import type { Role } from '@/lib/types';

const ROLES: Role[] = ['admin', 'editor', 'viewer'];

const log = (admin: ReturnType<typeof supabaseAdmin>, by: { id: string; username: string }, op: string, rowId: string, data: object) =>
  admin.from('audit_log').insert({ user_id: by.id, username: by.username, table_name: 'users', op, row_id: rowId, new_data: data });

/** Create a login. Password is generated from the username: jaskaran -> Jaskaran@isft */
export async function POST(req: Request) {
  const g = await guard(['admin']);
  if (!g.ok) return g.response;

  const body = (await req.json().catch(() => ({}))) as { full_name?: string; username?: string; role?: Role; must_change_password?: boolean };
  const full_name = (body.full_name ?? '').trim();
  const username = cleanUsername(body.username ?? '');
  const role = body.role && ROLES.includes(body.role) ? body.role : 'viewer';
  if (!full_name) return NextResponse.json({ error: 'Enter the person\'s name.' }, { status: 400 });
  if (username.length < 2) return NextResponse.json({ error: 'Username needs at least 2 letters or digits.' }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  if (taken) return NextResponse.json({ error: `Username "${username}" is already taken. Try another.` }, { status: 409 });

  const password = defaultPassword(username);
  const { data: created, error } = await admin.auth.admin.createUser({
    email: toEmail(username), password, email_confirm: true, user_metadata: { username, full_name },
  });
  if (error || !created.user) return NextResponse.json({ error: error?.message ?? 'Could not create the login.' }, { status: 400 });

  const { error: pErr } = await admin.from('profiles').insert({
    id: created.user.id, username, full_name, role, must_change_password: body.must_change_password !== false,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }
  await log(admin, g.profile, 'CREATE_USER', created.user.id, { username, role });
  return NextResponse.json({ username, password, role });
}

/** Reset password, enable / disable, change role. */
export async function PATCH(req: Request) {
  const g = await guard(['admin']);
  if (!g.ok) return g.response;

  const { id, action, role } = (await req.json().catch(() => ({}))) as { id?: string; action?: string; role?: Role };
  if (!id) return NextResponse.json({ error: 'Missing user.' }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: target } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  const self = id === g.user.id;

  switch (action) {
    case 'reset_password': {
      const password = defaultPassword(target.username);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
      await log(admin, g.profile, 'RESET_PASSWORD', id, { username: target.username });
      return NextResponse.json({ username: target.username, password });
    }
    case 'deactivate': {
      if (self) return NextResponse.json({ error: 'You cannot disable your own login.' }, { status: 400 });
      await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
      await admin.from('profiles').update({ active: false }).eq('id', id);
      await log(admin, g.profile, 'DEACTIVATE_USER', id, { username: target.username });
      return NextResponse.json({ ok: true });
    }
    case 'activate': {
      await admin.auth.admin.updateUserById(id, { ban_duration: 'none' });
      await admin.from('profiles').update({ active: true }).eq('id', id);
      await log(admin, g.profile, 'ACTIVATE_USER', id, { username: target.username });
      return NextResponse.json({ ok: true });
    }
    case 'set_role': {
      if (!role || !ROLES.includes(role)) return NextResponse.json({ error: 'Pick a role.' }, { status: 400 });
      if (self) return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
      await admin.from('profiles').update({ role }).eq('id', id);
      await log(admin, g.profile, 'SET_ROLE', id, { username: target.username, role });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
}
