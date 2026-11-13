// SERVER ONLY. Loads the caller's organization and its settings with the service role.
import { cache } from 'react';
import { supabaseAdmin } from './supabase/admin';
import type { Org } from './org';
import type { Settings } from './types';

export async function loadOrg(orgId: string | null | undefined): Promise<Org | null> {
  if (!orgId) return null;
  const { data } = await supabaseAdmin().from('organizations').select('*').eq('id', orgId).maybeSingle();
  return (data as Org | null) ?? null;
}

/** Per-request cached variant for server components. */
export const orgById = cache(loadOrg);

export async function orgSettings(orgId: string): Promise<Settings | null> {
  const { data } = await supabaseAdmin().from('settings').select('*').eq('org_id', orgId).maybeSingle();
  return (data as Settings | null) ?? null;
}

export async function isPlatformAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabaseAdmin().from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

/** Google Drive sub-folder for an organization's files. The first organization keeps the folders it already had. */
export const driveFolderFor = (org: Pick<Org, 'slug'>, sub: string) => (org.slug === 'derivion' ? sub : `${org.slug} · ${sub}`);
