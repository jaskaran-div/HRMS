import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

/** Body: { token, platform } — this phone gets push notifications for the logged-in user. */
export async function POST(req: Request) {
  const g = await guard();
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { token?: string; platform?: string };
  if (!b.token || !TOKEN.test(b.token)) return NextResponse.json({ error: 'Invalid push token.' }, { status: 400 });
  // a phone belongs to whoever logged in last on it. Delete + insert (not upsert): the previous login may be in
  // another organization, and rows never move between organizations.
  const admin = supabaseAdmin();
  await admin.from('push_tokens').delete().eq('token', b.token).neq('user_id', g.user.id);
  const { error } = await admin.from('push_tokens').upsert(
    { token: b.token, user_id: g.user.id, platform: String(b.platform ?? '').slice(0, 20) || null, updated_at: new Date().toISOString() },
    { onConflict: 'token' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Body: { token } — logging out: stop pushing to this phone. */
export async function DELETE(req: Request) {
  const g = await guard();
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { token?: string };
  if (b.token) await supabaseAdmin().from('push_tokens').delete().eq('token', b.token).eq('user_id', g.user.id);
  return NextResponse.json({ ok: true });
}
