// SERVER ONLY. The logged-in web user with their organization, for server layouts and pages.
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { orgById, isPlatformAdmin } from './tenant';
import { orgHasAccess, type Org } from './org';
import type { Profile, Role } from './types';

export interface WebSession { user: { id: string; email?: string | null }; profile: Profile; org: Org; platformAdmin: boolean }

/**
 * Who is logged in, and their organization. Sends them where they must go first:
 * disabled → logout; email not verified → /verify-email. Does NOT check payment — see requireAccess().
 */
export const webSession = cache(async (): Promise<WebSession> => {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) redirect('/login');
  const admin = supabaseAdmin();
  const [{ data: profile }, { data: m }, platformAdmin] = await Promise.all([
    admin.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    admin.from('memberships').select('org_id, role, status').eq('user_id', user.id).maybeSingle(),
    isPlatformAdmin(user.id),
  ]);
  if (!profile || !profile.active || !m || m.status !== 'active') {
    if (platformAdmin) redirect('/admin');
    redirect('/api/logout');
  }
  const org = await orgById(m.org_id);
  if (!org) redirect('/api/logout');
  if (!org.email_verified_at) redirect('/verify-email');
  return { user, profile: { ...(profile as Profile), role: m.role as Role }, org, platformAdmin };
});

/** Paid / exempt organizations only: others go to Billing (owner) or the "locked" page (everyone else). */
export async function requireAccess(s: WebSession) {
  if (orgHasAccess(s.org)) return;
  redirect(s.profile.role === 'owner' && s.org.status !== 'suspended' ? '/billing' : '/locked');
}
