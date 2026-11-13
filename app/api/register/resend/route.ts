import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clientIp, currentUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { EMAIL_RE, sendOwnerVerification } from '@/lib/registration';

export const dynamic = 'force-dynamic';

/**
 * Sends the verification email again. Body: { email } (or the logged-in, unverified owner).
 * Always answers the same way, so it cannot be used to find out which emails are registered.
 */
export async function POST(req: Request) {
  const ip = (await clientIp()) ?? 'unknown';
  if (!rateLimit(`resend:${ip}`, 5, 3600_000)) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { email?: string };
  const admin = supabaseAdmin();
  const user = await currentUser().catch(() => null);
  const email = (user?.email ?? String(b.email ?? '')).trim().toLowerCase();
  const generic = NextResponse.json({ ok: true, message: 'If that account is waiting for verification, a new link is on its way.' });
  if (!EMAIL_RE.test(email) || !rateLimit(`resend:${email}`, 3, 3600_000)) return generic;

  const { data: org } = await admin.from('organizations').select('id, name, owner_user_id, email_verified_at').eq('owner_email', email).is('email_verified_at', null).maybeSingle();
  if (!org?.owner_user_id) return generic;
  const { data: p } = await admin.from('profiles').select('full_name').eq('id', org.owner_user_id).maybeSingle();
  await sendOwnerVerification({ userId: org.owner_user_id, orgId: org.id, email, name: p?.full_name ?? '', orgName: org.name, req });
  return generic;
}
