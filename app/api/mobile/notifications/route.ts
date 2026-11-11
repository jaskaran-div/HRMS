import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** The latest 100 notifications of the logged-in user. */
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.response;
  const { data, error } = await supabaseAdmin().from('notifications').select('id, kind, title, body, data, read_at, created_at')
    .eq('user_id', g.user.id).order('created_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] });
}

/** Body: { ids?: string[] } — marks those (or, without ids, all) as read. */
export async function PATCH(req: Request) {
  const g = await guard();
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { ids?: unknown };
  let q = supabaseAdmin().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', g.user.id).is('read_at', null);
  if (Array.isArray(b.ids)) q = q.in('id', b.ids.filter((x): x is string => typeof x === 'string'));
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
