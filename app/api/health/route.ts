import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — for uptime monitors and deploy checks. Public answer: { ok, uptime_s } (no database call, so it
 * cannot be used to load the database). With `Authorization: Bearer <CRON_SECRET>` it also pings the database and
 * reports memory: { db_ms, rss_mb, heap_mb }; 503 when the database does not answer.
 */
export async function GET(req: Request) {
  const base = { ok: true, uptime_s: Math.round(process.uptime()) };
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json(base, { headers: { 'Cache-Control': 'no-store' } });

  const start = performance.now();
  const { error } = await supabaseAdmin().from('organizations').select('id', { head: true, count: 'planned' }).limit(1);
  const mem = process.memoryUsage();
  const body = {
    ...base, ok: !error, db_ms: Math.round(performance.now() - start), db_error: error?.message ?? null,
    rss_mb: Math.round(mem.rss / 1048576), heap_mb: Math.round(mem.heapUsed / 1048576),
  };
  return NextResponse.json(body, { status: error ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
