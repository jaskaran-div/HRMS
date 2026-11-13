// SERVER ONLY. Keeps an organization's subscription, status and entitlements in step with Stripe.
// Everything here re-reads the current state from the Stripe API instead of trusting an event payload
// or a browser redirect, so events can arrive late, twice or out of order without harm.
import type Stripe from 'stripe';
import { supabaseAdmin } from '../supabase/admin';
import { basePriceId, featureOfPrice, liveMode, stripe } from '../stripe';
import { statusFromStripe, type Org } from '../org';
import { audit } from '../audit';

const TERMINAL = new Set(['canceled', 'incomplete_expired']);
const ts = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);
export const idOf = (x: string | { id: string } | null | undefined) => (typeof x === 'string' ? x : x?.id ?? null);

/** Returns the organization's Stripe customer for the current mode (test / live), creating it if needed. */
export async function ensureCustomer(org: Org, email: string | null): Promise<string> {
  const live = liveMode();
  if (org.stripe_customer_id && org.stripe_livemode === live) return org.stripe_customer_id;
  const c = await stripe().customers.create({
    name: org.name, email: email ?? org.owner_email ?? undefined,
    metadata: { org_id: org.id, org_slug: org.slug },
  }, { idempotencyKey: `customer-${org.id}-${live ? 'live' : 'test'}` });
  // switched between test and live: the old ids belong to the other mode and must not be reused
  await supabaseAdmin().from('organizations').update({
    stripe_customer_id: c.id, stripe_livemode: live,
    ...(org.stripe_livemode !== null && org.stripe_livemode !== live ? { stripe_subscription_id: null, stripe_subscription_status: null, stripe_items: [], addons: [] } : {}),
  }).eq('id', org.id);
  return c.id;
}

/** Finds the organization a Stripe object belongs to: metadata.org_id (checked against the customer), else the customer id. */
export async function orgForStripe(customerId: string | null, metadataOrgId?: string | null): Promise<Org | null> {
  const admin = supabaseAdmin();
  if (metadataOrgId) {
    const { data } = await admin.from('organizations').select('*').eq('id', metadataOrgId).maybeSingle();
    const o = data as Org | null;
    // metadata is only trusted when the customer matches too (or the org has none yet)
    if (o && (!customerId || !o.stripe_customer_id || o.stripe_customer_id === customerId)) return o;
  }
  if (!customerId) return null;
  const { data } = await admin.from('organizations').select('*').eq('stripe_customer_id', customerId).maybeSingle();
  return (data as Org | null) ?? null;
}

/**
 * Re-reads a subscription from Stripe and stores status, period, base plan and add-ons on the organization.
 * Access is granted only for Stripe's paid states (see statusFromStripe). Returns the new status.
 */
export async function syncSubscription(org: Org, subscriptionId: string, source: string): Promise<string | null> {
  const sub = await stripe().subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
  const customer = idOf(sub.customer);
  if (org.stripe_customer_id && customer !== org.stripe_customer_id) {
    console.warn(`stripe sync: subscription ${sub.id} belongs to customer ${customer}, not org ${org.id}`);
    return null;
  }
  // an older subscription (e.g. a cancelled one) must not overwrite the organization's current one
  if (org.stripe_subscription_id && org.stripe_subscription_id !== sub.id) {
    const keepCurrent = !(org.stripe_subscription_status && TERMINAL.has(org.stripe_subscription_status)) && TERMINAL.has(sub.status);
    if (keepCurrent) return org.stripe_subscription_status;
  }
  const items = sub.items.data.map(i => ({ id: i.id, price: i.price.id, quantity: i.quantity ?? 1, feature: featureOfPrice(i.price.id) }));
  const base = items.find(i => i.price === basePriceId()) ?? items.find(i => !i.feature) ?? null;
  const addons = [...new Set(items.map(i => i.feature).filter((f): f is NonNullable<typeof f> => !!f))];
  const status = org.status === 'suspended' ? 'suspended' : statusFromStripe(sub.status);

  const patch = {
    stripe_customer_id: customer, stripe_livemode: sub.livemode,
    stripe_subscription_id: sub.id, stripe_subscription_status: sub.status, stripe_base_price_id: base?.price ?? null,
    stripe_items: items, addons: TERMINAL.has(sub.status) ? [] : addons, status,
    current_period_start: ts(sub.current_period_start), current_period_end: ts(sub.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end, cancel_at: ts(sub.cancel_at), canceled_at: ts(sub.canceled_at), ended_at: ts(sub.ended_at),
    stripe_synced_at: new Date().toISOString(),
    ...(sub.status === 'active' ? { last_payment_error: null } : {}),
  };
  const { error } = await supabaseAdmin().from('organizations').update(patch).eq('id', org.id);
  if (error) throw new Error(`could not save subscription: ${error.message}`);

  const changed = org.status !== status || org.stripe_subscription_status !== sub.status
    || JSON.stringify([...(org.addons ?? [])].sort()) !== JSON.stringify([...patch.addons].sort())
    || org.cancel_at_period_end !== sub.cancel_at_period_end;
  if (changed) await audit({
    orgId: org.id, actorName: source, action: 'billing.subscription_changed', target: { type: 'subscription', id: sub.id },
    details: { from: org.status, to: status, stripe_status: sub.status, addons: patch.addons, cancel_at_period_end: sub.cancel_at_period_end },
  });
  return status;
}

/** Stores / updates one invoice for the payment history. */
export async function recordInvoice(org: Org, inv: Stripe.Invoice): Promise<void> {
  if (!inv.id) return;
  const lastError = inv.last_finalization_error?.message
    ?? (typeof inv.payment_intent === 'object' && inv.payment_intent?.last_payment_error?.message) ?? null;
  const { error } = await supabaseAdmin().from('billing_invoices').upsert({
    id: inv.id, org_id: org.id, livemode: inv.livemode, subscription_id: idOf(inv.subscription), number: inv.number,
    status: inv.status, billing_reason: inv.billing_reason, currency: inv.currency,
    amount_due: inv.amount_due, amount_paid: inv.amount_paid, amount_remaining: inv.amount_remaining,
    attempt_count: inv.attempt_count, next_payment_attempt: ts(inv.next_payment_attempt), last_error: lastError,
    hosted_invoice_url: inv.hosted_invoice_url ?? null, invoice_pdf: inv.invoice_pdf ?? null,
    period_start: ts(inv.lines?.data?.[0]?.period?.start ?? inv.period_start), period_end: ts(inv.lines?.data?.[0]?.period?.end ?? inv.period_end),
    paid_at: ts(inv.status_transitions?.paid_at), created_at: ts(inv.created) ?? new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(`could not save invoice: ${error.message}`);
}

/** Platform admin "Sync from Stripe": the organization's newest subscription, invoices included. */
export async function reconcileOrg(org: Org): Promise<string | null> {
  if (!org.stripe_customer_id) return org.status;
  const s = stripe();
  let subId = org.stripe_subscription_id;
  if (!subId) {
    const list = await s.subscriptions.list({ customer: org.stripe_customer_id, status: 'all', limit: 1 });
    subId = list.data[0]?.id ?? null;
  }
  const status = subId ? await syncSubscription(org, subId, 'Stripe reconcile') : org.status;
  const invoices = await s.invoices.list({ customer: org.stripe_customer_id, limit: 24 });
  for (const inv of invoices.data) await recordInvoice(org, inv);
  return status;
}
