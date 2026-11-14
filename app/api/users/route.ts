import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cleanUsername, defaultPassword, toEmail } from '@/lib/username';
import { accountAddress, appUrl, emailAccountStatus, emailLoginDetails, validEmail, type MailResult } from '@/lib/notify-mail';
import { assignableRoles, canManageTarget, NEEDS_EMPLOYEE, ROLE_LABEL, USER_MANAGER_ROLES } from '@/lib/roles';
import type { Profile, Role } from '@/lib/types';

/** Checks the employee exists in this organization and has no other login. Returns an error message or null. */
async function checkEmployee(admin: ReturnType<typeof supabaseAdmin>, orgId: string, employeeId: string, exceptUser?: string) {
  const { data: emp } = await admin.from('employees').select('id, name').eq('id', employeeId).eq('org_id', orgId).maybeSingle();
  if (!emp) return 'That employee does not exist.';
  const { data: other } = await admin.from('profiles').select('id, username').eq('employee_id', employeeId).maybeSingle();
  if (other && other.id !== exceptUser) return `${emp.name} already has a login (${other.username}).`;
  return null;
}

/** Logins of the caller's organization (HR admins cannot read other profiles from the browser). */
export async function GET() {
  const g = await guard(USER_MANAGER_ROLES);
  if (!g.ok) return g.response;
  const { data, error } = await supabaseAdmin().from('profiles')
    .select('id, username, full_name, role, org_id, active, must_change_password, employee_id, email, created_at')
    .eq('org_id', g.org.id).order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [], assignable: assignableRoles(g.profile.role) });
}

/**
 * Create a login directly (username + generated password: jaskaran -> Jaskaran@isft).
 * For a real email + self-chosen password, use an invitation (/api/invitations) instead.
 */
export async function POST(req: Request) {
  const g = await guard(USER_MANAGER_ROLES);
  if (!g.ok) return g.response;
  const orgId = g.org.id;

  const body = (await req.json().catch(() => ({}))) as {
    full_name?: string; username?: string; role?: Role; must_change_password?: boolean; employee_id?: string | null;
    email?: string | null; send_email?: boolean;
  };
  const email = (body.email ?? '').trim() || null;
  if (email && !validEmail(email)) return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 });
  const full_name = (body.full_name ?? '').trim();
  const username = cleanUsername(body.username ?? '');
  const allowed = assignableRoles(g.profile.role);
  const role = body.role && allowed.includes(body.role) ? body.role : null;
  if (!role) return NextResponse.json({ error: 'You cannot give that role.' }, { status: 403 });
  if (!full_name) return NextResponse.json({ error: 'Enter the person\'s name.' }, { status: 400 });
  if (username.length < 2) return NextResponse.json({ error: 'Username needs at least 2 letters or digits.' }, { status: 400 });

  const employee_id = body.employee_id || null;
  if (NEEDS_EMPLOYEE.includes(role) && !employee_id)
    return NextResponse.json({ error: 'Pick the employee this login belongs to.' }, { status: 400 });

  const admin = supabaseAdmin();
  if (employee_id) {
    const bad = await checkEmployee(admin, orgId, employee_id);
    if (bad) return NextResponse.json({ error: bad }, { status: 409 });
  }
  // usernames are unique across ALL organizations (they are part of the login)
  const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  if (taken) return NextResponse.json({ error: `Username "${username}" is already taken. Try another.` }, { status: 409 });

  const password = defaultPassword(username);
  const { data: created, error } = await admin.auth.admin.createUser({
    email: toEmail(username), password, email_confirm: true, user_metadata: { username, full_name },
  });
  if (error || !created.user) return NextResponse.json({ error: error?.message ?? 'Could not create the login.' }, { status: 400 });

  const { error: pErr } = await admin.from('profiles').insert({
    id: created.user.id, org_id: orgId, username, full_name, role, employee_id, email, must_change_password: body.must_change_password !== false,
  });
  const { error: mErr } = pErr ? { error: pErr } : await admin.from('memberships').insert({ org_id: orgId, user_id: created.user.id, role, invited_by: g.user.id });
  if (pErr || mErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: (pErr ?? mErr)!.message }, { status: 400 });
  }
  let mail: MailResult | null = null;
  if (body.send_email !== false) {
    const to = await accountAddress({ email, employee_id });
    mail = to
      ? await emailLoginDetails({ to, name: full_name, username, password, role, mustChange: body.must_change_password !== false, url: appUrl(req), kind: 'new' }, orgId)
      : { ok: false, error: 'No email address — add one to the login or the employee record.' };
  }
  return NextResponse.json({ username, password, role, mail });
}

/** Reset or set password, enable / disable, change role, link to an employee — within the caller's organization and role limits. */
export async function PATCH(req: Request) {
  const g = await guard(USER_MANAGER_ROLES);
  if (!g.ok) return g.response;
  const orgId = g.org.id;

  const { id, action, role, password, must_change_password, employee_id, email, send_email } = (await req.json().catch(() => ({}))) as {
    id?: string; action?: string; role?: Role; password?: string; must_change_password?: boolean; employee_id?: string | null;
    email?: string | null; send_email?: boolean;
  };
  if (!id) return NextResponse.json({ error: 'Missing user.' }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: target } = await admin.from('profiles').select('*').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  const self = id === g.user.id;
  if (!self && !canManageTarget(g.profile.role, target.role as Role))
    return NextResponse.json({ error: target.role === 'owner' ? 'The owner’s login can only be changed by the owner (ownership can be transferred in Settings).' : 'You cannot manage this login.' }, { status: 403 });
  const url = appUrl(req);
  /** Emails the new password to the person (unless HR unticked it, or it is your own). */
  const mailPassword = async (pw: string, must: boolean): Promise<MailResult | null> => {
    if (send_email === false || self) return null;
    const to = await accountAddress(target as Profile);
    return to
      ? emailLoginDetails({ to, name: target.full_name, username: target.username, password: pw, role: target.role, mustChange: must, url, kind: 'reset' }, orgId)
      : { ok: false, error: 'No email address on file for this login.' };
  };

  switch (action) {
    case 'reset_password': {
      const password = defaultPassword(target.username);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
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
      return NextResponse.json({ username: target.username, password: pw, mail: await mailPassword(pw, must) });
    }
    case 'set_employee': {
      const emp = employee_id || null;
      if (!emp && NEEDS_EMPLOYEE.includes(target.role)) return NextResponse.json({ error: 'Team leader and employee logins must be linked to an employee.' }, { status: 400 });
      if (emp) {
        const bad = await checkEmployee(admin, orgId, emp, id);
        if (bad) return NextResponse.json({ error: bad }, { status: 409 });
      }
      await admin.from('profiles').update({ employee_id: emp }).eq('id', id);
      return NextResponse.json({ ok: true });
    }
    case 'set_email': {
      const e = (email ?? '').trim() || null;
      if (e && !validEmail(e)) return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 });
      await admin.from('profiles').update({ email: e }).eq('id', id);
      return NextResponse.json({ ok: true });
    }
    case 'delete': {
      // removes the login only; employee, attendance, payslips and leave history stay (their links become empty)
      if (self) return NextResponse.json({ error: 'You cannot delete your own login.' }, { status: 400 });
      if (target.role === 'admin') {
        const { count } = await admin.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', orgId).in('role', ['admin', 'owner']).eq('status', 'active');
        if ((count ?? 0) <= 1) return NextResponse.json({ error: 'This is the last admin login. Make someone else admin first.' }, { status: 400 });
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await admin.from('profiles').delete().eq('id', id); // normally removed by the cascade already
      return NextResponse.json({ ok: true });
    }
    case 'deactivate': {
      if (self) return NextResponse.json({ error: 'You cannot disable your own login.' }, { status: 400 });
      await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
      await admin.from('profiles').update({ active: false }).eq('id', id);
      await admin.from('memberships').update({ status: 'deactivated' }).eq('user_id', id).eq('org_id', orgId);
      await admin.from('push_tokens').delete().eq('user_id', id);
      return NextResponse.json({ ok: true, mail: await emailAccountStatus(target as Profile, false, url) });
    }
    case 'activate': {
      await admin.auth.admin.updateUserById(id, { ban_duration: 'none' });
      await admin.from('profiles').update({ active: true }).eq('id', id);
      await admin.from('memberships').update({ status: 'active' }).eq('user_id', id).eq('org_id', orgId);
      return NextResponse.json({ ok: true, mail: await emailAccountStatus(target as Profile, true, url) });
    }
    case 'set_role': {
      if (!role || !assignableRoles(g.profile.role).includes(role)) return NextResponse.json({ error: `You cannot give the ${ROLE_LABEL[role as Role] ?? 'chosen'} role.` }, { status: 403 });
      if (self) return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
      if (NEEDS_EMPLOYEE.includes(role) && !target.employee_id)
        return NextResponse.json({ error: 'Link this login to an employee first (Employee column).' }, { status: 400 });
      // memberships is the source of truth; a trigger mirrors the role onto profiles
      const { error } = await admin.from('memberships').update({ role }).eq('user_id', id).eq('org_id', orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
}
