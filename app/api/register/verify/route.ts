import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hashToken, validTokenShape } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

const to = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

/** The link in the verification email. Marks the email confirmed, then sends the owner to log in. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  if (!validTokenShape(token)) return to('/verify-email?error=invalid');
  const admin = supabaseAdmin();
  const { data: row } = await admin.from('email_verifications').select('*').eq('token_hash', hashToken(token)).maybeSingle();
  if (!row || row.used_at) return to('/verify-email?error=used');
  if (new Date(row.expires_at).getTime() < Date.now()) return to('/verify-email?error=expired');

  // single use, even if two clicks arrive at once
  const { data: claimed } = await admin.from('email_verifications').update({ used_at: new Date().toISOString() })
    .eq('id', row.id).is('used_at', null).select('id').maybeSingle();
  if (!claimed) return to('/verify-email?error=used');
  const { error } = await admin.auth.admin.updateUserById(row.user_id, { email_confirm: true });
  if (error) return to('/verify-email?error=failed');
  await admin.from('organizations').update({ email_verified_at: new Date().toISOString() }).eq('id', row.org_id).is('email_verified_at', null);
  return to('/login?verified=1');
}
