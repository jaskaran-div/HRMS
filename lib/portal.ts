// SERVER ONLY: uses the service-role client. Every function here checks who is asking before returning data.
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { officialEmailOf, phoneOf } from './official-email';
import { orgById } from './tenant';
import { orgHasAccess, type Org } from './org';
import type { Employee, Profile, Role, Settings } from './types';

/**
 * Contact details often live only in the imported sheet's extra columns ("Official Mail Id", "Phone Number").
 * Fill email / phone from there, then drop `extra` so nothing else in it (Aadhaar, PAN, …) reaches the page.
 */
function withContact<T extends { email?: string | null; phone?: string | null; extra?: Record<string, string> | null }>(row: T | null): Omit<T, 'extra'> | null {
  if (!row) return null;
  const { extra, ...rest } = row;
  return { ...rest, email: officialEmailOf(row), phone: phoneOf(row) } as Omit<T, 'extra'>;
}

/** Columns a team leader may see about the people in their team (no bank, PAN, salary or emergency details). */
export const TEAM_COLUMNS = 'id, emp_code, name, department, designation, email, phone, doj, location, team_lead_id, archived_at';
/** Columns an employee sees about themselves. */
export const SELF_COLUMNS = 'id, emp_code, name, department, designation, email, phone, emergency_name, emergency_phone, doj, dob, location, manager, bank_name, account_no, ifsc, pan, pf_no, monthly_salary, team_lead_id, archived_at';

export type TeamMember = Pick<Employee, 'id' | 'emp_code' | 'name' | 'department' | 'designation' | 'email' | 'phone' | 'doj' | 'location' | 'team_lead_id' | 'archived_at'>;
export type SelfRecord = Omit<Employee, 'extra' | 'exit_type' | 'exit_remarks' | 'pf_amount' | 'tds_amount'>;

export interface PortalSession {
  org: Org;
  profile: Profile;
  settings: Settings;
  me: SelfRecord | null;
  lead: TeamMember | null;
  isLead: boolean;
}

/** The logged-in portal user (team leader / employee, or HR staff linked to an employee). Redirects when not allowed. */
export const portalSession = cache(async (): Promise<PortalSession> => {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const admin = supabaseAdmin();
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    admin.from('memberships').select('org_id, role, status').eq('user_id', user.id).maybeSingle(),
  ]);
  if (!profile || !profile.active || !membership || membership.status !== 'active') redirect('/api/logout');
  const org = await orgById(membership.org_id);
  if (!org) redirect('/api/logout');
  if (!org.email_verified_at) redirect('/verify-email');
  if (!orgHasAccess(org)) redirect('/locked');
  if (profile.must_change_password) redirect('/change-password');
  const p = { ...(profile as Profile), role: membership.role as Role };

  const [{ data: settings }, { data: me }] = await Promise.all([
    admin.from('settings').select('*').eq('org_id', org.id).single(),
    p.employee_id ? admin.from('employees').select(`${SELF_COLUMNS}, extra`).eq('id', p.employee_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!settings) throw new Error('Settings row missing. Did you run supabase/saas.sql?');
  const self = withContact(me as (SelfRecord & { extra: Record<string, string> }) | null) as SelfRecord | null;
  const { data: lead } = self?.team_lead_id
    ? await admin.from('employees').select(`${TEAM_COLUMNS}, extra`).eq('id', self.team_lead_id).maybeSingle()
    : { data: null };
  return { org, profile: p, settings: settings as Settings, me: self, lead: withContact(lead as (TeamMember & { extra: Record<string, string> }) | null) as TeamMember | null, isLead: p.role === 'team_lead' };
});

/** Ids of everyone below this employee in the hierarchy. */
export async function teamIds(leadEmployeeId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin().rpc('team_tree', { lead: leadEmployeeId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as (string | { team_tree: string })[]).map(x => (typeof x === 'string' ? x : x.team_tree));
}

/** Active members of the logged-in team leader's team (empty for non-leads). */
export async function myTeam(s: PortalSession): Promise<TeamMember[]> {
  if (!s.isLead || !s.me) return [];
  const ids = await teamIds(s.me.id);
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin().from('employees').select(`${TEAM_COLUMNS}, extra`).in('id', ids).is('archived_at', null).order('name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as (TeamMember & { extra: Record<string, string> })[]).map(r => withContact(r) as TeamMember);
}
