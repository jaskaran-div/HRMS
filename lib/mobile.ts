// SERVER ONLY. Shared checks for the /api/mobile/* routes used by the mobile app.
import { NextResponse } from 'next/server';
import { guard } from './auth';
import { supabaseAdmin } from './supabase/admin';
import { officialEmailOf, phoneOf } from './official-email';
import { SELF_COLUMNS, TEAM_COLUMNS, teamIds, type SelfRecord, type TeamMember } from './portal';
import type { Org } from './org';
import type { Profile, Settings } from './types';

export interface MobileSession {
  org: Org;
  profile: Profile;
  settings: Settings;
  me: SelfRecord;
  lead: TeamMember | null;
  isLead: boolean;
}

type Result = { ok: true; s: MobileSession } | { ok: false; response: NextResponse };

const strip = <T extends { extra?: Record<string, string> | null; email?: string | null; phone?: string | null }>(r: T) => {
  const { extra: _extra, ...rest } = r;
  return { ...rest, email: officialEmailOf(r), phone: phoneOf(r) };
};

/** Logged-in login linked to an active employee record. Same rules as the web portal. */
export async function mobileSession(): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;
  const p = g.profile;
  if (!p.employee_id)
    return { ok: false, response: NextResponse.json({ error: 'Your login is not linked to an employee record. Ask HR to link it under User Access.', code: 'not_linked' }, { status: 403 }) };
  const admin = supabaseAdmin();
  const [{ data: settings }, { data: me }] = await Promise.all([
    admin.from('settings').select('*').eq('org_id', g.org.id).single(),
    admin.from('employees').select(`${SELF_COLUMNS}, extra`).eq('id', p.employee_id).maybeSingle(),
  ]);
  if (!settings) return { ok: false, response: NextResponse.json({ error: 'Settings row missing.' }, { status: 500 }) };
  if (!me || me.archived_at) return { ok: false, response: NextResponse.json({ error: 'Your employee record is inactive.', code: 'inactive' }, { status: 403 }) };
  const self = strip(me as SelfRecord & { extra: Record<string, string> }) as SelfRecord;
  const { data: lead } = self.team_lead_id
    ? await admin.from('employees').select(`${TEAM_COLUMNS}, extra`).eq('id', self.team_lead_id).maybeSingle()
    : { data: null };
  return {
    ok: true,
    s: {
      org: g.org, profile: p, settings: settings as Settings, me: self,
      lead: lead ? (strip(lead as TeamMember & { extra: Record<string, string> }) as TeamMember) : null,
      isLead: p.role === 'team_lead',
    },
  };
}

/** Active team members below the logged-in team leader. */
export async function mobileTeam(s: MobileSession): Promise<TeamMember[]> {
  if (!s.isLead) return [];
  const ids = await teamIds(s.me.id);
  if (!ids.length) return [];
  const { data } = await supabaseAdmin().from('employees').select(`${TEAM_COLUMNS}, extra`).in('id', ids).is('archived_at', null).order('name');
  return ((data ?? []) as (TeamMember & { extra: Record<string, string> })[]).map(r => strip(r) as TeamMember);
}

export const ymParam = (v: string | null) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
