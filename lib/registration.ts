// SERVER ONLY. Shared helpers for creating organizations and logins.
import { supabaseAdmin } from './supabase/admin';
import { cleanUsername } from './username';
import { hashToken, hoursFromNow, newToken } from './tokens';
import { baseUrl, emailVerifyOwner } from './platform-mail';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A free username from an email / name: "asha.k@acme.com" → "ashak", "ashak2", … */
export async function freeUsername(seed: string): Promise<string> {
  const base = (cleanUsername(seed.split('@')[0] ?? '') || 'user').slice(0, 24).padEnd(2, '0');
  const admin = supabaseAdmin();
  for (let i = 0; i < 50; i++) {
    const u = i === 0 ? base : `${base}${i + 1}`;
    const { data } = await admin.from('profiles').select('id').eq('username', u).maybeSingle();
    if (!data) return u;
  }
  return `${base.slice(0, 20)}${Math.floor(Math.random() * 1e6)}`;
}

export async function freeSlug(name: string): Promise<string> {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
  const admin = supabaseAdmin();
  for (let i = 0; i < 20; i++) {
    const s = i === 0 ? (base.length < 2 ? `${base}-org` : base) : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (s === 'derivion' && i === 0) continue; // reserved for the first organization
    const { data } = await admin.from('organizations').select('id').eq('slug', s).maybeSingle();
    if (!data) return s;
  }
  return `org-${crypto.randomUUID().slice(0, 8)}`;
}

/** Creates a fresh verification link for the owner and emails it. Old unused links stop working. */
export async function sendOwnerVerification(o: { userId: string; orgId: string; email: string; name: string; orgName: string; req?: Request }) {
  const admin = supabaseAdmin();
  await admin.from('email_verifications').delete().eq('user_id', o.userId).is('used_at', null);
  const token = newToken();
  const { error } = await admin.from('email_verifications').insert({ user_id: o.userId, org_id: o.orgId, token_hash: hashToken(token), expires_at: hoursFromNow(24) });
  if (error) return { ok: false as const, error: error.message };
  return emailVerifyOwner({ to: o.email, name: o.name, orgName: o.orgName, link: `${baseUrl(o.req)}/api/register/verify?token=${token}` });
}
