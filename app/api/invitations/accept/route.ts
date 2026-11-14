import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clientIp } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { validTokenShape } from '@/lib/tokens';
import { invitationByToken } from '@/lib/invitations';
import { freeUsername } from '@/lib/registration';
import { ROLE_LABEL } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/** GET ?token= — what the invitation is for (shown before choosing a password). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  const inv = validTokenShape(token) ? await invitationByToken(token) : null;
  if (!inv) return NextResponse.json({ error: 'This invitation link is invalid, used or expired. Ask for a new one.' }, { status: 404 });
  const { data: org } = await supabaseAdmin().from('organizations').select('name').eq('id', inv.org_id).single();
  return NextResponse.json({ email: inv.email, full_name: inv.full_name, role: ROLE_LABEL[inv.role], org: org?.name ?? '', inviter: inv.invited_by_name });
}

/** POST { token, password } — creates the login (email already proven by the link) and joins the organization. */
export async function POST(req: Request) {
  const ip = (await clientIp()) ?? 'unknown';
  if (!rateLimit(`accept:${ip}`, 10, 3600_000)) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
  const password = String(b.password ?? '');
  if (!validTokenShape(b.token)) return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  if (password.length < 10) return NextResponse.json({ error: 'Use a password of at least 10 characters.' }, { status: 400 });
  const inv = await invitationByToken(b.token);
  if (!inv) return NextResponse.json({ error: 'This invitation link is invalid, used or expired. Ask for a new one.' }, { status: 404 });

  const admin = supabaseAdmin();
  // claim it first so the same link cannot create two accounts
  const { data: claimed } = await admin.from('invitations').update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', inv.id).eq('status', 'pending').select('id').maybeSingle();
  if (!claimed) return NextResponse.json({ error: 'This invitation was already used.' }, { status: 409 });
  const undo = () => admin.from('invitations').update({ status: 'pending', accepted_at: null }).eq('id', inv.id);

  if (inv.employee_id) {
    const { data: other } = await admin.from('profiles').select('id').eq('employee_id', inv.employee_id).maybeSingle();
    if (other) { await undo(); return NextResponse.json({ error: 'This employee already has a login. Ask HR.' }, { status: 409 }); }
  }
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email: inv.email, password, email_confirm: true, user_metadata: { full_name: inv.full_name },
  });
  if (uErr || !created.user) {
    await undo();
    const taken = /already|registered|exists/i.test(uErr?.message ?? '');
    return NextResponse.json({ error: taken ? 'An account with this email already exists. Log in, or ask HR to invite another address.' : (uErr?.message ?? 'Could not create the account.') }, { status: taken ? 409 : 400 });
  }
  const userId = created.user.id;
  const username = await freeUsername(inv.email);
  const { error: pErr } = await admin.from('profiles').insert({
    id: userId, org_id: inv.org_id, username, full_name: inv.full_name, role: inv.role, employee_id: inv.employee_id, email: inv.email, must_change_password: false,
  });
  const { error: mErr } = pErr ? { error: pErr } : await admin.from('memberships').insert({ org_id: inv.org_id, user_id: userId, role: inv.role, invited_by: inv.invited_by });
  if (pErr || mErr) {
    await admin.auth.admin.deleteUser(userId);
    await undo();
    const limit = /limit reached/i.test(mErr?.message ?? '');
    return NextResponse.json({ error: limit ? 'This organization has reached its login limit. Ask them to free a login or raise the limit.' : 'Could not finish creating your account. Please try again.' }, { status: limit ? 409 : 500 });
  }
  await admin.from('invitations').update({ accepted_user_id: userId }).eq('id', inv.id);
  return NextResponse.json({ ok: true, email: inv.email, username });
}
