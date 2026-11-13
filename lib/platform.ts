// SERVER ONLY. Data for the platform super admin panel (/admin).
import { notFound } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { isPlatformAdmin } from './tenant';
import type { Org } from './org';

/** For /admin pages: platform super admins only; everyone else gets a 404 (the panel's existence is not revealed). */
export async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user || !(await isPlatformAdmin(user.id))) notFound();
  return user;
}

export interface OrgListRow extends Org { members: number; failed_invoices: number }

export async function listOrgs(): Promise<OrgListRow[]> {
  const admin = supabaseAdmin();
  const [{ data: orgs }, { data: members }, { data: failed }] = await Promise.all([
    admin.from('organizations').select('*').order('created_at', { ascending: false }),
    admin.from('memberships').select('org_id').eq('status', 'active'),
    admin.from('billing_invoices').select('org_id').in('status', ['open', 'uncollectible']).gt('attempt_count', 0),
  ]);
  const count = (rows: { org_id: string }[] | null, id: string) => (rows ?? []).filter(r => r.org_id === id).length;
  return ((orgs ?? []) as Org[]).map(o => ({ ...o, members: count(members, o.id), failed_invoices: count(failed, o.id) }));
}

export async function orgDetail(id: string) {
  const admin = supabaseAdmin();
  const { data: org } = await admin.from('organizations').select('*').eq('id', id).maybeSingle();
  if (!org) return null;
  const [{ data: invoices }, { data: events }, { data: owner }, { count: members }, { data: audit }] = await Promise.all([
    admin.from('billing_invoices').select('*').eq('org_id', id).order('created_at', { ascending: false }).limit(50),
    admin.from('stripe_events').select('id, type, status, attempts, error, received_at, processed_at').eq('org_id', id).order('received_at', { ascending: false }).limit(50),
    org.owner_user_id ? admin.from('profiles').select('full_name, username, email').eq('id', org.owner_user_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', id).eq('status', 'active'),
    admin.from('org_audit_logs').select('actor_name, action, details, created_at').eq('org_id', id).like('action', 'billing.%').order('created_at', { ascending: false }).limit(30),
  ]);
  return { org: org as Org, invoices: invoices ?? [], events: events ?? [], owner, members: members ?? 0, audit: audit ?? [] };
}
