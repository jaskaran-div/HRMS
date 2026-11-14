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

export interface NewOrg {
  orgName: string; fullName: string; email: string; password: string;
  phone?: string | null; country?: string | null; employees?: number | null;
  /** registration: false (owner must verify); platform admin: true */
  emailVerified: boolean;
  status?: 'pending_payment' | 'active';
  billingExempt?: boolean;
  maxEmployees?: number | null; maxUsers?: number | null;
  overrides?: { grant?: string[]; revoke?: string[] };
}

/**
 * Creates login + organization + owner profile + OWNER membership + settings row, all or nothing.
 * Returns the new ids, or an error message (`taken` = the email already has a login).
 */
export async function createOrganization(o: NewOrg): Promise<{ ok: true; orgId: string; userId: string; username: string } | { ok: false; error: string; taken?: boolean }> {
  const admin = supabaseAdmin();
  const email = o.email.trim().toLowerCase();
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email, password: o.password, email_confirm: o.emailVerified, user_metadata: { full_name: o.fullName },
  });
  if (uErr || !created.user) {
    const taken = /already|registered|exists/i.test(uErr?.message ?? '');
    return { ok: false, taken, error: taken ? 'An account with this email already exists.' : (uErr?.message ?? 'Could not create the login.') };
  }
  const userId = created.user.id;
  let orgId: string | null = null;
  try {
    const { data: org, error: oErr } = await admin.from('organizations').insert({
      name: o.orgName, slug: await freeSlug(o.orgName), status: o.status ?? 'pending_payment', owner_user_id: userId, owner_email: email,
      phone: o.phone ?? null, country: o.country ?? null, employee_count_hint: o.employees ?? null,
      email_verified_at: o.emailVerified ? new Date().toISOString() : null, billing_exempt: !!o.billingExempt,
      max_employees: o.maxEmployees ?? null, max_users: o.maxUsers ?? null, entitlement_overrides: o.overrides ?? {},
    }).select('id').single();
    if (oErr || !org) throw new Error(oErr?.message ?? 'organization');
    orgId = org.id as string;
    const username = await freeUsername(email);
    const { error: pErr } = await admin.from('profiles').insert({
      id: userId, org_id: orgId, username, full_name: o.fullName, role: 'owner', email, must_change_password: false,
    });
    if (pErr) throw new Error(pErr.message);
    const { error: mErr } = await admin.from('memberships').insert({ org_id: orgId, user_id: userId, role: 'owner' });
    if (mErr) throw new Error(mErr.message);
    const { error: sErr } = await admin.from('settings').insert({
      org_id: orgId, company_name: o.orgName, company_address: '', footer_note: '-- This is a system-generated document. --',
      sender_name: o.orgName, sender_email: process.env.PLATFORM_SENDER_EMAIL || process.env.SMTP_USER || email,
      reply_to: email, hr_email: email, email_domains: email.split('@')[1],
    });
    if (sErr) throw new Error(sErr.message);
    return { ok: true, orgId, userId, username };
  } catch (e) {
    // undo everything: the organization (cascades to profile, membership, settings) and the login
    if (orgId) await admin.from('organizations').delete().eq('id', orgId);
    await admin.auth.admin.deleteUser(userId);
    console.error('create organization failed', e);
    return { ok: false, error: 'Could not create the organization. Please try again.' };
  }
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
