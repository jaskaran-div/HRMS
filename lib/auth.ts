import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { loadOrg, isPlatformAdmin } from './tenant';
import { orgFeatures, orgHasAccess, type Org } from './org';
import type { Feature } from './billing/catalog';
import type { Profile, Role } from './types';

type Guard =
  | { ok: true; user: { id: string; email?: string | null }; profile: Profile; org: Org }
  | { ok: false; response: NextResponse };

export interface GuardOptions {
  /** allow when the organization has no paid access yet (billing, onboarding, the status endpoint) */
  allowLocked?: boolean;
  /** the organization's plan must include this feature */
  feature?: Feature;
}

const fail = (error: string, status: number, code?: string) =>
  ({ ok: false as const, response: NextResponse.json({ error, ...(code ? { code } : {}) }, { status }) });

/** The logged-in Supabase user: web session cookie, or `Authorization: Bearer <access token>` from the mobile app. */
export async function currentUser() {
  const token = /^Bearer\s+(\S+)/i.exec((await headers()).get('authorization') ?? '')?.[1];
  const { data: { user } } = token
    ? await supabaseAdmin().auth.getUser(token)
    : await (await supabaseServer()).auth.getUser();
  return user;
}

/**
 * For API routes: the caller must be logged in, active, belong to an organization that is verified and has
 * paid access (unless allowLocked), and (optionally) have one of the given roles / the given feature.
 * Every query the route makes afterwards must stay inside `org.id`.
 */
export async function guard(roles?: Role[], opts: GuardOptions = {}): Promise<Guard> {
  const user = await currentUser();
  if (!user) return fail('Not logged in', 401);
  const admin = supabaseAdmin();
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    admin.from('memberships').select('org_id, role, status').eq('user_id', user.id).maybeSingle(),
  ]);
  if (!profile || !profile.active) return fail('Account disabled', 403, 'disabled');
  if (!membership || membership.status !== 'active' || membership.org_id !== profile.org_id)
    return fail('Your login is not part of an active organization.', 403, 'no_membership');
  const org = await loadOrg(membership.org_id);
  if (!org) return fail('Organization not found.', 403, 'no_membership');
  if (!org.email_verified_at) return fail('Verify your email address first.', 403, 'email_unverified');
  if (!opts.allowLocked && !orgHasAccess(org))
    return fail(org.status === 'suspended'
      ? 'This organization is suspended. Contact support.'
      : 'This organization’s subscription is not active. The owner can activate it in Billing on the web.', 402, 'org_inactive');
  const p = { ...(profile as Profile), role: membership.role as Role };
  if (roles && !roles.includes(p.role)) return fail('You do not have permission to do this', 403, 'forbidden');
  if (opts.feature && !orgFeatures(org).includes(opts.feature))
    return fail('This feature is not part of your organization’s plan. The owner can add it in Billing.', 402, 'feature_missing');
  return { ok: true, user, profile: p, org };
}

/** Platform super admin (the SaaS operator) for /admin and /api/admin/*. Not tied to any organization. */
export async function platformGuard(): Promise<{ ok: true; user: { id: string; email?: string | null } } | { ok: false; response: NextResponse }> {
  const user = await currentUser();
  if (!user) return fail('Not logged in', 401);
  if (!(await isPlatformAdmin(user.id))) return fail('Not found', 404);
  return { ok: true, user };
}

/** Client IP for the audit log (behind nginx on EC2). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim() || null;
}
