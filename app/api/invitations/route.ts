import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { assignableRoles, NEEDS_EMPLOYEE, ROLE_LABEL, USER_MANAGER_ROLES } from '@/lib/roles';
import { EMAIL_RE } from '@/lib/registration';
import { hashToken, hoursFromNow, newToken } from '@/lib/tokens';
import { INVITE_DAYS, sendInvitation, type InvitationRow } from '@/lib/invitations';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Invitations of the caller's organization. */
export async function GET() {
  const g = await guard(USER_MANAGER_ROLES);
  if (!g.ok) return g.response;
  const { data, error } = await supabaseAdmin().from('invitations')
    .select('id, email, full_name, role, employee_id, status, invited_by_name, expires_at, accepted_at, created_at')
    .eq('org_id', g.org.id).order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invitations: data ?? [], assignable: assignableRoles(g.profile.role) });
}

/**
 * Invite someone by email. Body: { email, full_name, role, employee_id? }
 * owner → admin / hr_admin / viewer / team_lead / employee; hr_admin → team_lead / employee (see lib/roles.ts).
 */
export async function POST(req: Request) {
  const g = await guard(USER_MANAGER_ROLES);
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { email?: string; full_name?: string; role?: Role; employee_id?: string | null };
  const email = String(b.email ?? '').trim().toLowerCase();
  const fullName = String(b.full_name ?? '').trim().slice(0, 120);
  const role = b.role as Role;
  const employeeId = b.employee_id || null;
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (fullName.length < 2) return NextResponse.json({ error: 'Enter the person’s name.' }, { status: 400 });
  if (!assignableRoles(g.profile.role).includes(role)) return NextResponse.json({ error: `You cannot invite someone as ${ROLE_LABEL[role] ?? role}.` }, { status: 403 });
  if (NEEDS_EMPLOYEE.includes(role) && !employeeId) return NextResponse.json({ error: 'Pick the employee record this login belongs to.' }, { status: 400 });

  const admin = supabaseAdmin();
  if (employeeId) {
    const { data: emp } = await admin.from('employees').select('id, name').eq('id', employeeId).eq('org_id', g.org.id).maybeSingle();
    if (!emp) return NextResponse.json({ error: 'That employee does not exist.' }, { status: 404 });
    const { data: other } = await admin.from('profiles').select('username').eq('employee_id', employeeId).maybeSingle();
    if (other) return NextResponse.json({ error: `${emp.name} already has a login (${other.username}).` }, { status: 409 });
  }
  if (g.org.max_users != null) {
    const { count } = await admin.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', g.org.id).eq('status', 'active');
    if ((count ?? 0) >= g.org.max_users)
      return NextResponse.json({ error: `Login limit reached: your plan allows ${g.org.max_users} active logins. Disable a login or ask for a higher limit.` }, { status: 409 });
  }
  const { data: existing } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (existing) return NextResponse.json({ error: 'Someone already has an account with this email.' }, { status: 409 });

  // a pending invitation for the same email is replaced (new link, new details)
  await admin.from('invitations').update({ status: 'revoked' }).eq('org_id', g.org.id).ilike('email', email).eq('status', 'pending');
  const { data: inv, error } = await admin.from('invitations').insert({
    org_id: g.org.id, email, full_name: fullName, role, employee_id: employeeId, token_hash: hashToken(newToken()),
    invited_by: g.user.id, invited_by_name: g.profile.full_name, expires_at: hoursFromNow(INVITE_DAYS * 24),
  }).select('*').single();
  if (error || !inv) return NextResponse.json({ error: error?.message ?? 'Could not create the invitation.' }, { status: 500 });
  const mail = await sendInvitation(inv as InvitationRow, g.org.name, g.profile.full_name, req);
  return NextResponse.json({ invitation: inv, mail });
}

/** Body: { id, action: 'resend' | 'revoke' } */
export async function PATCH(req: Request) {
  const g = await guard(USER_MANAGER_ROLES);
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
  const admin = supabaseAdmin();
  const { data } = await admin.from('invitations').select('*').eq('id', b.id ?? '').eq('org_id', g.org.id).maybeSingle();
  const inv = data as InvitationRow | null;
  if (!inv) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
  if (!assignableRoles(g.profile.role).includes(inv.role)) return NextResponse.json({ error: 'You cannot manage this invitation.' }, { status: 403 });
  if (inv.status === 'accepted') return NextResponse.json({ error: 'Already accepted.' }, { status: 409 });
  if (b.action === 'revoke') {
    await admin.from('invitations').update({ status: 'revoked' }).eq('id', inv.id);
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'resend') {
    const mail = await sendInvitation(inv, g.org.name, g.profile.full_name, req);
    return NextResponse.json({ ok: true, mail });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
