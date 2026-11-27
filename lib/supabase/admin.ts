import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Database requests slower than this are logged (method, table / function, status, time — never filters, bodies
 * or results, so no employee data reaches the log). SLOW_QUERY_MS=0 turns it off.
 */
const SLOW_MS = Number(process.env.SLOW_QUERY_MS ?? 1000);

const timedFetch: typeof fetch = async (input, init) => {
  const start = performance.now();
  const res = await fetch(input, init);
  const ms = performance.now() - start;
  if (SLOW_MS > 0 && ms >= SLOW_MS) {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    console.warn(`[slow-db] ${init?.method ?? 'GET'} ${url.pathname} ${res.status} ${Math.round(ms)}ms`);
  }
  return res;
};

let client: SupabaseClient | undefined;

/**
 * Service-role client: bypasses Row Level Security. SERVER ONLY (API routes / scripts).
 * Never import this from a file that a client component imports.
 *
 * One client for the whole process (it holds no login: autoRefreshToken / persistSession are off and nothing signs
 * in with it — re-authentication uses its own anon client), instead of a new one on every call.
 */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  });
  return client;
}
