import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rate-limit';
import { hashToken, hoursFromNow, newToken, validTokenShape } from '@/lib/tokens';
import { baseUrl, emailOwnershipDone, emailOwnershipOffer } from '@/lib/platform-mail';
import { notifyUsers } from '@/lib/push';

export const dynamic = 'force-dynamic';

const CANDIDATE_ROLES = ['admin', 'hr_admin'];

/** Owner / admin: the pending transfer (if any) and who ownership can go to. */
export async function GET() {
  const g = await guard(['owner', 'admin']);
  if (!g.ok) return g.response;
  const admin = supabaseAdmin();
  const [{ data: pending }, { data: members }] = await Promise.all([
    admin.from('ownership_transfers').select('id, to_user_id, expires_at, created_at').eq('org_id', g.org.id).eq('status', 'pending').maybeSingle(),
    admin.from('memberships').select('user_id, role, profiles!memberships_user_id_fkey!inner(full_name, username, email, active)').eq('org_id', g.org.id).eq('status', 'active').in('role', CANDIDATE_ROLES),
  ]);
  return NextResponse.json({
    pending: pending && new Date(pending.expires_at) > new Date() ? pending : null,
    candidates: (members ?? []).map(m => {
      const p = m.profiles as unknown as { full_name: string; username: string; email: string | null; active: boolean };
      return { id: m.user_id, role: m.role, full_name: p.full_name, username: p.username, email: p.email, active: p.active };
    }).filter(c => c.active),
  });
}

/**
 * { action: 'start', to_user_id, password } — owner, after re-entering their password; emails the new owner.
 * { action: 'cancel' }                      — owner cancels a pending offer.
 * { action: 'accept', token }               — the chosen member, logged in as themselves, accepts.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; to_user_id?: string; password?: string; token?: string };
  const admin = supabaseAdmin();

  if (b.action === 'accept') {
    const g = await guard();
    if (!g.ok) return g.response;
    if (!validTokenShape(b.token)) return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
    const { data: t } = await admin.from('ownership_transfers').select('*').eq('token_hash', hashToken(b.token)).eq('status', 'pending').maybeSingle();
    if (!t || new Date(t.expires_at) < new Date()) return NextResponse.json({ error: 'This transfer link is invalid or has expired.' }, { status: 404 });
    if (t.to_user_id !== g.user.id || t.org_id !== g.org.id) return NextResponse.json({ error: 'This transfer was offered to someone else. Log in as that person.' }, { status: 403 });
    const { error } = await admin.rpc('transfer_ownership', { transfer: t.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const { data: prev } = await admin.from('profiles').select('id, full_name, email').eq('id', t.from_user_id).maybeSingle();
    const { data: prevUser } = await admin.auth.admin.getUserById(t.from_user_id);
    const to = prev?.email || prevUser.user?.email;
    if (to) await emailOwnershipDone({ to, name: prev?.full_name ?? '', orgName: g.org.name, newOwner: g.profile.full_name });
    await notifyUsers([t.from_user_id], { kind: 'ownership', title: 'Ownership transferred', body: `${g.profile.full_name} is now the owner of ${g.org.name}.` });
    return NextResponse.json({ ok: true });
  }

  const g = await guard(['owner']);
  if (!g.ok) return g.response;

  if (b.action === 'cancel') {
    await admin.from('ownership_transfers').update({ status: 'cancelled', decided_at: new Date().toISOString() })
      .eq('org_id', g.org.id).eq('status', 'pending');
    return NextResponse.json({ ok: true });
  }

  if (b.action !== 'start') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (!rateLimit(`ownership:${g.user.id}`, 5, 3600_000)) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  if (!b.to_user_id || b.to_user_id === g.user.id) return NextResponse.json({ error: 'Pick who should become the owner.' }, { status: 400 });

  // re-authenticate: the password must be the owner's current one
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: pwErr } = await anon.auth.signInWithPassword({ email: g.user.email ?? '', password: String(b.password ?? '') });
  if (pwErr) return NextResponse.json({ error: 'Your password is not correct.' }, { status: 403 });
  await anon.auth.signOut();

  const { data: m } = await admin.from('memberships').select('role, status').eq('user_id', b.to_user_id).eq('org_id', g.org.id).maybeSingle();
  if (!m || m.status !== 'active' || !CANDIDATE_ROLES.includes(m.role))
    return NextResponse.json({ error: 'Ownership can only go to an active admin or HR admin of this organization.' }, { status: 400 });
  const { data: target } = await admin.from('profiles').select('full_name, email, active').eq('id', b.to_user_id).single();
  const { data: targetUser } = await admin.auth.admin.getUserById(b.to_user_id);
  const email = target?.email || (targetUser.user?.email?.endsWith(`@${process.env.NEXT_PUBLIC_LOGIN_DOMAIN || 'derivion.in'}`) ? null : targetUser.user?.email);

  await admin.from('ownership_transfers').update({ status: 'cancelled' }).eq('org_id', g.org.id).eq('status', 'pending');
  const token = newToken();
  const { error } = await admin.from('ownership_transfers').insert({
    org_id: g.org.id, from_user_id: g.user.id, to_user_id: b.to_user_id, token_hash: hashToken(token), expires_at: hoursFromNow(72),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const link = `${baseUrl(req)}/ownership/accept?token=${token}`;
  const mail = email ? await emailOwnershipOffer({ to: email, name: target?.full_name ?? '', orgName: g.org.name, from: g.profile.full_name, link }) : { ok: false as const, error: 'No email address on this login.' };
  await notifyUsers([b.to_user_id], { kind: 'ownership', title: 'Ownership offered to you', body: `${g.profile.full_name} wants to make you the owner of ${g.org.name}. Accept it on the web.` });
  return NextResponse.json({ ok: true, mail, ...(mail.ok ? {} : { link }) });
}
