import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client: bypasses Row Level Security. SERVER ONLY (API routes / scripts).
 * Never import this from a file that a client component imports.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
