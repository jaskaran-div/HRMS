// SERVER ONLY. Data for the platform super admin panel (/admin). Uses the service role: every function here
// must only be reached through requirePlatformAdmin() / platformGuard().
import { notFound } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { isPlatformAdmin } from './tenant';
import type { Org, OrgStatus } from './org';
import type { Role } from './types';

/** For /admin pages: platform super admins only; everyone else gets a 404 (the panel's existence is not revealed). */
export async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user || !(await isPlatformAdmin(user.id))) notFound();
  return user;
}

/** Counts per organization id, read in pages (an organization can have thousands of rows). */
async function countBy(table: 'employees' | 'memberships', filter: (q: any) => any): Promise<Map<string, number>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const m = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await filter(supabaseAdmin().from(table).select('org_id')).range(from, from + 999);
    for (const r of (data ?? []) as { org_id: string }[]) m.set(r.org_id, (m.get(r.org_id) ?? 0) + 1);
    if (!data || data.length < 1000) break;
  }
  return m;
}

export interface OrgRow extends Org { employees: number; users: number; failed: number; max_employees: number | null; max_users: number | null }

export async function listOrgs(f: { q?: string; status?: string } = {}): Promise<OrgRow[]> {
  const admin = supabaseAdmin();
  let q = admin.from('organizations').select('*').order('created_at', { ascending: false });
  if (f.status === 'exempt') q = q.eq('billing_exempt', true);
  else if (f.status) q = q.eq('status', f.status);
  if (f.q?.trim()) {
    const t = f.q.trim().replace(/[,()*%\\]/g, '');
    q = q.or(`name.ilike.*${t}*,slug.ilike.*${t}*,owner_email.ilike.*${t}*,stripe_customer_id.ilike.*${t}*`);
  }
  const [{ data: orgs }, emps, users, { data: failed }] = await Promise.all([
    q,
    countBy('employees', x => x.is('archived_at', null)),
    countBy('memberships', x => x.eq('status', 'active')),
    admin.from('billing_invoices').select('org_id').eq('status', 'open').gt('attempt_count', 0),
  ]);
  const fails = new Map<string, number>();
  for (const r of failed ?? []) fails.set(r.org_id, (fails.get(r.org_id) ?? 0) + 1);
  return ((orgs ?? []) as OrgRow[]).map(o => ({ ...o, employees: emps.get(o.id) ?? 0, users: users.get(o.id) ?? 0, failed: fails.get(o.id) ?? 0 }));
}

export interface Member { user_id: string; role: Role; status: string; full_name: string; username: string; email: string | null; login_email: string | null; employee_id: string | null; created_at: string }

export async function orgDetail(id: string) {
  const admin = supabaseAdmin();
  const { data: org } = await admin.from('organizations').select('*').eq('id', id).maybeSingle();
  if (!org) return null;
  const [{ data: invoices }, { data: events }, { data: members }, { count: employees }, { count: archived }, { data: settings }] = await Promise.all([
    admin.from('billing_invoices').select('*').eq('org_id', id).order('created_at', { ascending: false }).limit(100),
    admin.from('stripe_events').select('id, type, status, attempts, error, received_at').eq('org_id', id).order('received_at', { ascending: false }).limit(30),
    admin.from('memberships').select('user_id, role, status, created_at, profiles!memberships_user_id_fkey!inner(full_name, username, email, employee_id)').eq('org_id', id).order('created_at'),
    admin.from('employees').select('id', { count: 'exact', head: true }).eq('org_id', id).is('archived_at', null),
    admin.from('employees').select('id', { count: 'exact', head: true }).eq('org_id', id).not('archived_at', 'is', null),
    admin.from('settings').select('company_name, company_address, hr_email, email_domains').eq('org_id', id).maybeSingle(),
  ]);
  const list: Member[] = (members ?? []).map(m => {
    const p = m.profiles as unknown as { full_name: string; username: string; email: string | null; employee_id: string | null };
    return { user_id: m.user_id, role: m.role as Role, status: m.status, created_at: m.created_at, full_name: p.full_name, username: p.username, email: p.email, login_email: null, employee_id: p.employee_id };
  });
  return {
    org: org as OrgRow, invoices: invoices ?? [], events: events ?? [], members: list, settings,
    employees: employees ?? 0, archived: archived ?? 0,
  };
}

export interface PaymentRow {
  id: string; org_id: string; org_name: string; number: string | null; status: string | null; billing_reason: string | null;
  currency: string | null; amount_due: number | null; amount_paid: number | null; attempt_count: number | null; last_error: string | null;
  hosted_invoice_url: string | null; invoice_pdf: string | null; period_start: string | null; period_end: string | null; paid_at: string | null; created_at: string; livemode: boolean;
}

export async function listPayments(f: { status?: string; org?: string; days?: number } = {}): Promise<PaymentRow[]> {
  const admin = supabaseAdmin();
  let q = admin.from('billing_invoices').select('*, organizations!inner(name)').order('created_at', { ascending: false }).limit(500);
  if (f.status === 'failed') q = q.eq('status', 'open').gt('attempt_count', 0);
  else if (f.status) q = q.eq('status', f.status);
  if (f.org) q = q.eq('org_id', f.org);
  if (f.days) q = q.gte('created_at', new Date(Date.now() - f.days * 86400_000).toISOString());
  const { data } = await q;
  return (data ?? []).map(r => ({ ...(r as PaymentRow), org_name: (r.organizations as unknown as { name: string }).name }));
}

/** Sum of amounts per currency (Stripe smallest unit). */
export const totals = (rows: { currency: string | null; amount: number | null }[]) => {
  const m = new Map<string, number>();
  for (const r of rows) if (r.currency && r.amount) m.set(r.currency, (m.get(r.currency) ?? 0) + r.amount);
  return [...m.entries()];
};

export async function dashboard() {
  const admin = supabaseAdmin();
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: orgs }, emps, users, { data: paid30 }, { data: failed }, { data: recentPaid }] = await Promise.all([
    admin.from('organizations').select('id, name, slug, status, billing_exempt, created_at, current_period_end, cancel_at_period_end, owner_email').order('created_at', { ascending: false }),
    countBy('employees', x => x.is('archived_at', null)),
    countBy('memberships', x => x.eq('status', 'active')),
    admin.from('billing_invoices').select('amount_paid, currency').eq('status', 'paid').gte('paid_at', since30),
    admin.from('billing_invoices').select('id, org_id, number, amount_due, currency, attempt_count, last_error, created_at, organizations!inner(name)').eq('status', 'open').gt('attempt_count', 0).order('created_at', { ascending: false }).limit(10),
    admin.from('billing_invoices').select('id, org_id, number, amount_paid, currency, paid_at, organizations!inner(name)').eq('status', 'paid').order('paid_at', { ascending: false }).limit(10),
  ]);
  const all = (orgs ?? []) as (Pick<Org, 'id' | 'name' | 'slug' | 'status' | 'billing_exempt' | 'created_at' | 'current_period_end' | 'cancel_at_period_end' | 'owner_email'>)[];
  const byStatus = new Map<OrgStatus, number>();
  for (const o of all) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  const soon = Date.now() + 7 * 86400_000;
  // sign-ups per month, the last 6 months (oldest first)
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, k) => {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + k, 1));
    return m.toISOString().slice(0, 7);
  });
  const signups = months.map(m => [m, all.filter(o => o.created_at.slice(0, 7) === m).length] as [string, number]);
  const largest = all.map(o => ({ id: o.id, name: o.name, employees: emps.get(o.id) ?? 0, users: users.get(o.id) ?? 0 }))
    .sort((a, b) => b.employees - a.employees).slice(0, 6);
  return {
    signups, largest,
    orgCount: all.length,
    byStatus: [...byStatus.entries()],
    exempt: all.filter(o => o.billing_exempt).length,
    newThisMonth: all.filter(o => o.created_at >= since30).length,
    employees: [...emps.values()].reduce((a, b) => a + b, 0),
    users: [...users.values()].reduce((a, b) => a + b, 0),
    revenue30: totals((paid30 ?? []).map(i => ({ currency: i.currency, amount: i.amount_paid }))),
    failed: (failed ?? []).map(f => ({ ...f, org_name: (f.organizations as unknown as { name: string }).name })),
    recentPaid: (recentPaid ?? []).map(f => ({ ...f, org_name: (f.organizations as unknown as { name: string }).name })),
    recentOrgs: all.slice(0, 8),
    renewingSoon: all.filter(o => o.current_period_end && new Date(o.current_period_end).getTime() < soon && new Date(o.current_period_end).getTime() > Date.now()),
  };
}
