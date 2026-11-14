import { NextResponse } from 'next/server';
import { platformGuard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { reconcileOrg } from '@/lib/billing/sync';
import { liveMode, stripe, stripeConfigured } from '@/lib/stripe';
import { ALL_FEATURES } from '@/lib/billing/catalog';
import { statusFromStripe, type Org } from '@/lib/org';
import { NEEDS_EMPLOYEE } from '@/lib/roles';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MEMBER_ROLES: Role[] = ['admin', 'hr_admin', 'editor', 'viewer', 'team_lead', 'employee'];
const limit = (v: unknown) => (v === '' || v == null ? null : Math.max(0, Math.floor(Number(v))) || 0);
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Platform admin management of one organization. Body: { action, ... }
 *   details      { name, phone, country, owner_email, admin_notes, company_name?, company_address? }
 *   plan         { billing: 'exempt' | 'stripe', features: { [f]: 'plan' | 'on' | 'off' }, max_employees, max_users }
 *   sync         re-read subscription + invoices from Stripe
 *   suspend      { reason } | unsuspend
 *   member_role  { user_id, role }   (not owner — use make_owner)
 *   member_status{ user_id, active }
 *   make_owner   { user_id }         the current owner becomes an admin
 *   verify_email                     mark the owner's email verified (if they cannot receive the link)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await platformGuard();
  if (!g.ok) return g.response;
  const { id } = await params;
  const admin = supabaseAdmin();
  const { data } = await admin.from('organizations').select('*').eq('id', id).maybeSingle();
  const org = data as Org | null;
  if (!org) return bad('Organization not found.', 404);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);

  switch (b.action) {
    case 'details': {
      const name = str('name', 120);
      if (name.length < 2) return bad('Enter the organization name.');
      const { error } = await admin.from('organizations').update({
        name, phone: str('phone', 40) || null, country: str('country', 80) || null,
        owner_email: str('owner_email', 200).toLowerCase() || org.owner_email, admin_notes: str('admin_notes', 4000) || null,
      }).eq('id', id);
      if (error) return bad(error.message);
      if (b.company_name !== undefined)
        await admin.from('settings').update({ company_name: str('company_name', 120) || name, company_address: str('company_address', 400) }).eq('org_id', id);
      return NextResponse.json({ ok: true });
    }
    case 'plan': {
      const exempt = b.billing === 'exempt';
      const features = (b.features ?? {}) as Record<string, string>;
      const overrides = { grant: ALL_FEATURES.filter(f => features[f] === 'on'), revoke: ALL_FEATURES.filter(f => features[f] === 'off') };
      const status = org.status === 'suspended' ? 'suspended' : exempt ? 'active' : statusFromStripe(org.stripe_subscription_status);
      const { error } = await admin.from('organizations').update({
        billing_exempt: exempt, status, entitlement_overrides: overrides,
        max_employees: limit(b.max_employees), max_users: limit(b.max_users),
      }).eq('id', id);
      if (error) return bad(error.message);
      return NextResponse.json({ ok: true, status });
    }
    case 'sync': {
      if (!stripeConfigured()) return bad('Stripe is not configured on this server.', 503);
      try { return NextResponse.json({ ok: true, status: await reconcileOrg(org) }); }
      catch (e) { return bad(e instanceof Error ? e.message : String(e), 502); }
    }
    case 'suspend': {
      const reason = str('reason', 300);
      if (!reason) return bad('Give a reason (it is shown to the organization).');
      await admin.from('organizations').update({ status: 'suspended', suspended_reason: reason }).eq('id', id);
      return NextResponse.json({ ok: true });
    }
    case 'unsuspend': {
      const status = org.billing_exempt ? 'active' : statusFromStripe(org.stripe_subscription_status);
      await admin.from('organizations').update({ status, suspended_reason: null }).eq('id', id);
      return NextResponse.json({ ok: true, status });
    }
    case 'verify_email': {
      if (org.owner_user_id) await admin.auth.admin.updateUserById(org.owner_user_id, { email_confirm: true });
      await admin.from('organizations').update({ email_verified_at: org.email_verified_at ?? new Date().toISOString() }).eq('id', id);
      return NextResponse.json({ ok: true });
    }
    case 'member_role':
    case 'member_status':
    case 'make_owner': {
      const userId = str('user_id', 64);
      const { data: m } = await admin.from('memberships').select('role, status, profiles!memberships_user_id_fkey!inner(employee_id, full_name)').eq('org_id', id).eq('user_id', userId).maybeSingle();
      if (!m) return bad('Member not found.', 404);
      const p = m.profiles as unknown as { employee_id: string | null; full_name: string };
      if (b.action === 'member_role') {
        const role = b.role as Role;
        if (!MEMBER_ROLES.includes(role)) return bad('Pick a role (use “Make owner” for ownership).');
        if (m.role === 'owner') return bad('Make someone else the owner first.');
        if (NEEDS_EMPLOYEE.includes(role) && !p.employee_id) return bad('Team leaders and employees must be linked to an employee record (the organization does that under User Access).');
        const { error } = await admin.from('memberships').update({ role }).eq('org_id', id).eq('user_id', userId);
        return error ? bad(error.message) : NextResponse.json({ ok: true });
      }
      if (b.action === 'member_status') {
        const active = !!b.active;
        if (!active && m.role === 'owner') return bad('The owner cannot be disabled. Make someone else the owner first, or suspend the organization.');
        const { error } = await admin.from('memberships').update({ status: active ? 'active' : 'deactivated' }).eq('org_id', id).eq('user_id', userId);
        if (error) return bad(error.message); // e.g. the login limit
        await admin.from('profiles').update({ active }).eq('id', userId);
        await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' });
        if (!active) await admin.from('push_tokens').delete().eq('user_id', userId);
        return NextResponse.json({ ok: true });
      }
      // make_owner
      if (m.status !== 'active') return bad('Enable this login first.');
      if (m.role === 'owner') return NextResponse.json({ ok: true });
      await admin.from('memberships').update({ role: 'admin' }).eq('org_id', id).eq('role', 'owner');
      const { error } = await admin.from('memberships').update({ role: 'owner' }).eq('org_id', id).eq('user_id', userId);
      if (error) return bad(error.message);
      const { data: u } = await admin.auth.admin.getUserById(userId);
      const { data: prof } = await admin.from('profiles').select('email').eq('id', userId).single();
      await admin.from('organizations').update({ owner_user_id: userId, owner_email: prof?.email || u.user?.email || null }).eq('id', id);
      return NextResponse.json({ ok: true });
    }
    default:
      return bad('Unknown action.');
  }
}

/**
 * Deletes the organization for good: its employees, attendance, payslips, leave, documents list, settings,
 * logins and billing records. Cancels an active Stripe subscription first. Body: { confirm: <slug> }
 * Files in Google Drive are not removed (delete the organization's Drive folders by hand if needed).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await platformGuard();
  if (!g.ok) return g.response;
  const { id } = await params;
  const admin = supabaseAdmin();
  const { data } = await admin.from('organizations').select('*').eq('id', id).maybeSingle();
  const org = data as Org | null;
  if (!org) return bad('Organization not found.', 404);
  const b = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (b.confirm !== org.slug) return bad(`Type the organization's short name (${org.slug}) to confirm.`);
  const { data: mine } = await admin.from('memberships').select('org_id').eq('user_id', g.user.id).maybeSingle();
  if (mine?.org_id === id) return bad('You cannot delete the organization your own login belongs to.', 409);

  if (org.stripe_subscription_id && stripeConfigured() && org.stripe_livemode === liveMode()
    && !['canceled', 'incomplete_expired'].includes(org.stripe_subscription_status ?? '')) {
    try { await stripe().subscriptions.cancel(org.stripe_subscription_id); }
    catch (e) { return bad(`Could not cancel the Stripe subscription, nothing was deleted: ${e instanceof Error ? e.message : e}`, 502); }
  }
  const { data: logins } = await admin.from('profiles').select('id').eq('org_id', id);
  for (const p of logins ?? []) await admin.auth.admin.deleteUser(p.id);
  const { error } = await admin.from('organizations').delete().eq('id', id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
