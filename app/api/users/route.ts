import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cleanUsername, defaultPassword, toEmail } from '@/lib/username';
import { accountAddress, appUrl, emailAccountStatus, emailLoginDetails, validEmail, type MailResult } from '@/lib/notify-mail';
import type { Profile, Role } from '@/lib/types';

const ROLES: Role[] = ['admin', 'editor', 'viewer', 'team_lead', 'employee'];
const NEEDS_EMPLOYEE: Role[] = ['team_lead', 'employee'];

/** Checks the employee exists and has no other login. Returns an error message or null. */
async function checkEmployee(admin: ReturnType<typeof supabaseAdmin>, employeeId: string, exceptUser?: string) {
  const { data: emp } = await admin.from('employees').select('id, name').eq('id', employeeId).maybeSingle();
  if (!emp) return 'That employee does not exist.';
  const { data: other } = await admin.from('profiles').select('id, username').eq('employee_id', employeeId).maybeSingle();
  if (other && other.id !== exceptUser) return `${emp.name} already has a login (${other.username}).`;
  return null;
}

const log = (admin: ReturnType<typeof supabaseAdmin>, by: { id: string; username: string }, op: string, rowId: string, data: object) =>
  admin.from('audit_log').insert({ user_id: by.id, username: by.username, table_name: 'users', op, row_id: rowId, new_data: data });

/** Create a login. Password is generated from the username: jaskaran -> Jaskaran@isft */
export async function POST(req: Request) {
  const g = await guard(['admin']);
  if (!g.ok) return g.response;

  const body = (await req.json().catch(() => ({}))) as {
    full_name?: string; username?: string; role?: Role; must_change_password?: boolean; employee_id?: string | null;
    email?: string | null; send_email?: boolean;
  };
  const email = (body.email ?? '').trim() || null;
  if (email && !validEmail(email)) return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 });
  const full_name = (body.full_name ?? '').trim();
  const username = cleanUsername(body.username ?? '');
  const role = body.role && ROLES.includes(body.role) ? body.role : 'viewer';
  if (!full_name) return NextResponse.json({ error: 'Enter the person\'s name.' }, { status: 400 });
  if (username.length < 2) return NextResponse.json({ error: 'Username needs at least 2 letters or digits.' }, { status: 400 });

  const employee_id = body.employee_id || null;
  if (NEEDS_EMPLOYEE.includes(role) && !employee_id)
    return NextResponse.json({ error: 'Pick the employee this login belongs to.' }, { status: 400 });

  const admin = supabaseAdmin();
  if (employee_id) {
    const bad = await checkEmployee(admin, employee_id);
    if (bad) return NextResponse.json({ error: bad }, { status: 409 });
  }
  const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  if (taken) return NextResponse.json({ error: `Username "${username}" is already taken. Try another.` }, { status: 409 });

  const password = defaultPassword(username);
  const { data: created, error } = await admin.auth.admin.createUser({
    email: toEmail(username), password, email_confirm: true, user_metadata: { username, full_name },
  });
  if (error || !created.user) return NextResponse.json({ error: error?.message ?? 'Could not create the login.' }, { status: 400 });

  const { error: pErr } = await admin.from('profiles').insert({
    id: created.user.id, username, full_name, role, employee_id, email, must_change_password: body.must_change_password !== false,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }
  await log(admin, g.profile, 'CREATE_USER', created.user.id, { username, role, employee_id });
  let mail: MailResult | null = null;
  if (body.send_email !== false) {
    const to = await accountAddress({ email, employee_id });
    mail = to
      ? await emailLoginDetails({ to, name: full_name, username, password, role, mustChange: body.must_change_password !== false, url: appUrl(req), kind: 'new' })
      : { ok: false, error: 'No email address — add one to the login or the employee record.' };
  }
  return NextResponse.json({ username, password, role, mail });
}

/** Reset or set password, enable / disable, change role, link to an employee. */
export async function PATCH(req: Request) {
  const g = await guard(['admin']);
  if (!g.ok) return g.response;

  const { id, action, role, password, must_change_password, employee_id, email, send_email } = (await req.json().catch(() => ({}))) as {
    id?: string; action?: string; role?: Role; password?: string; must_change_password?: boolean; employee_id?: string | null;
    email?: string | null; send_email?: boolean;
  };
  if (!id) return NextResponse.json({ error: 'Missing user.' }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: target } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  const self = id === g.user.id;
  const url = appUrl(req);
  /** Emails the new password to the person (unless HR unticked it, or it is your own). */
  const mailPassword = async (pw: string, must: boolean): Promise<MailResult | null> => {
    if (send_email === false || self) return null;
    const to = await accountAddress(target as Profile);
    return to
      ? emailLoginDetails({ to, name: target.full_name, username: target.username, password: pw, role: target.role, mustChange: must, url, kind: 'reset' })
      : { ok: false, error: 'No email address on file for this login.' };
  };

  switch (action) {
    case 'reset_password': {
      const password = defaultPassword(target.username);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
      await log(admin, g.profile, 'RESET_PASSWORD', id, { username: target.username });
      return NextResponse.json({ username: target.username, password, mail: await mailPassword(password, true) });
    }
    case 'set_password': {
      // HR types a new password for someone who forgot theirs
      const pw = (password ?? '').trim();
      if (pw.length < 8) return NextResponse.json({ error: 'Use at least 8 characters.' }, { status: 400 });
      const { error } = await admin.auth.admin.updateUserById(id, { password: pw });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const must = self ? false : must_change_password !== false;
      await admin.from('profiles').update({ must_change_password: must }).eq('id', id);
      await log(admin, g.profile, 'SET_PASSWORD', id, { username: target.username, must_change_password: must });
      return NextResponse.json({ username: target.username, password: pw, mail: await mailPassword(pw, must) });
    }
    case 'set_employee': {
      const emp = employee_id || null;
      if (!emp && NEEDS_EMPLOYEE.includes(target.role)) return NextResponse.json({ error: 'Team leader and employee logins must be linked to an employee.' }, { status: 400 });
      if (emp) {
        const bad = await checkEmployee(admin, emp, id);
        if (bad) return NextResponse.json({ error: bad }, { status: 409 });
      }
      await admin.from('profiles').update({ employee_id: emp }).eq('id', id);
      await log(admin, g.profile, 'LINK_EMPLOYEE', id, { username: target.username, employee_id: emp });
      return NextResponse.json({ ok: true });
    }
    case 'set_email': {
      const e = (email ?? '').trim() || null;
      if (e && !validEmail(e)) return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 });
      await admin.from('profiles').update({ email: e }).eq('id', id);
      await log(admin, g.profile, 'SET_EMAIL', id, { username: target.username, email: e });
      return NextResponse.json({ ok: true });
    }
    case 'deactivate': {
      if (self) return NextResponse.json({ error: 'You cannot disable your own login.' }, { status: 400 });
      await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
      await admin.from('profiles').update({ active: false }).eq('id', id);
      await log(admin, g.profile, 'DEACTIVATE_USER', id, { username: target.username });
      return NextResponse.json({ ok: true, mail: await emailAccountStatus(target as Profile, false, url) });
    }
    case 'activate': {
      await admin.auth.admin.updateUserById(id, { ban_duration: 'none' });
      await admin.from('profiles').update({ active: true }).eq('id', id);
      await log(admin, g.profile, 'ACTIVATE_USER', id, { username: target.username });
      return NextResponse.json({ ok: true, mail: await emailAccountStatus(target as Profile, true, url) });
    }
    case 'set_role': {
      if (!role || !ROLES.includes(role)) return NextResponse.json({ error: 'Pick a role.' }, { status: 400 });
      if (self) return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
      if (NEEDS_EMPLOYEE.includes(role) && !target.employee_id)
        return NextResponse.json({ error: 'Link this login to an employee first (Employee column).' }, { status: 400 });
      await admin.from('profiles').update({ role }).eq('id', id);
      await log(admin, g.profile, 'SET_ROLE', id, { username: target.username, role });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
}
