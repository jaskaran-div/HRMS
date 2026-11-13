import { NextResponse } from 'next/server';
import { platformGuard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { reconcileOrg } from '@/lib/billing/sync';
import { stripeConfigured } from '@/lib/stripe';
import { isFeature } from '@/lib/billing/catalog';
import { statusFromStripe, type Org } from '@/lib/org';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Platform super admin: controlled subscription / entitlement management for one organization.
 * Body: { action: 'sync' }                                   — re-read subscription + invoices from Stripe
 *       { action: 'entitlements', grant: [], revoke: [] }    — feature overrides on top of the paid plan
 *       { action: 'exempt', value: boolean, reason? }        — managed plan without Stripe (e.g. invoiced offline)
 *       { action: 'suspend', reason } | { action: 'unsuspend' }
 * Card details are never stored or shown; payment changes happen in Stripe.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await platformGuard();
  if (!g.ok) return g.response;
  const { id } = await params;
  const admin = supabaseAdmin();
  const { data } = await admin.from('organizations').select('*').eq('id', id).maybeSingle();
  const org = data as Org | null;
  if (!org) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; grant?: unknown; revoke?: unknown; value?: boolean; reason?: string };
  const actorName = `Platform admin (${g.user.email ?? g.user.id})`;
  const reason = String(b.reason ?? '').trim().slice(0, 300) || null;

  switch (b.action) {
    case 'sync': {
      if (!stripeConfigured()) return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
      try {
        const status = await reconcileOrg(org);
        await audit({ orgId: id, actorName, action: 'platform.synced', details: { status } });
        return NextResponse.json({ ok: true, status });
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
    }
    case 'entitlements': {
      const list = (x: unknown) => [...new Set(Array.isArray(x) ? x.filter(isFeature) : [])];
      const overrides = { grant: list(b.grant), revoke: list(b.revoke) };
      await admin.from('organizations').update({ entitlement_overrides: overrides }).eq('id', id);
      await audit({ orgId: id, actorName, action: 'platform.entitlements_changed', details: { from: org.entitlement_overrides, to: overrides, reason } });
      return NextResponse.json({ ok: true });
    }
    case 'exempt': {
      const value = !!b.value;
      const status = value ? (org.status === 'suspended' ? 'suspended' : 'active') : org.status === 'suspended' ? 'suspended' : statusFromStripe(org.stripe_subscription_status);
      await admin.from('organizations').update({ billing_exempt: value, status }).eq('id', id);
      await audit({ orgId: id, actorName, action: 'platform.status_changed', details: { billing_exempt: value, status, reason } });
      return NextResponse.json({ ok: true });
    }
    case 'suspend': {
      if (!reason) return NextResponse.json({ error: 'Give a reason.' }, { status: 400 });
      await admin.from('organizations').update({ status: 'suspended', suspended_reason: reason }).eq('id', id);
      await audit({ orgId: id, actorName, action: 'platform.status_changed', details: { from: org.status, to: 'suspended', reason } });
      return NextResponse.json({ ok: true });
    }
    case 'unsuspend': {
      const status = org.billing_exempt ? 'active' : statusFromStripe(org.stripe_subscription_status);
      await admin.from('organizations').update({ status, suspended_reason: null }).eq('id', id);
      await audit({ orgId: id, actorName, action: 'platform.status_changed', details: { from: 'suspended', to: status, reason } });
      return NextResponse.json({ ok: true, status });
    }
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
}
