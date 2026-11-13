import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { liveMode, stripe, stripeConfigured } from '@/lib/stripe';
import { idOf, orgForStripe, recordInvoice, syncSubscription } from '@/lib/billing/sync';
import { audit } from '@/lib/audit';
import { emailPaymentFailed } from '@/lib/platform-mail';
import type { Org } from '@/lib/org';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A "processing" row older than this is treated as a crashed attempt and processed again. */
const STALE_MS = 5 * 60_000;

/**
 * Stripe → us. Order of checks: signature (STRIPE_WEBHOOK_SECRET), test/live mode, then idempotency by event id.
 * Handlers reconcile from the Stripe API, so a duplicate or out-of-order event cannot grant access by itself.
 * Answers 2xx only when the event is safely handled; any error → 500 so Stripe retries it.
 */
export async function POST(req: Request) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    if (!sig) throw new Error('missing signature');
    event = stripe().webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e) {
    return NextResponse.json({ error: `Invalid signature: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }
  if (event.livemode !== liveMode())
    return NextResponse.json({ error: `A ${event.livemode ? 'live' : 'test'} event reached the ${liveMode() ? 'live' : 'test'} server` }, { status: 400 });

  const admin = supabaseAdmin();
  const obj = event.data.object as { id?: string };
  const { error: insErr } = await admin.from('stripe_events').insert({ id: event.id, type: event.type, livemode: event.livemode, object_id: obj.id ?? null });
  if (insErr) {
    if (insErr.code !== '23505') return NextResponse.json({ error: insErr.message }, { status: 500 });
    const { data: prev } = await admin.from('stripe_events').select('status, received_at, attempts').eq('id', event.id).single();
    if (prev && (prev.status === 'processed' || prev.status === 'ignored')) return NextResponse.json({ received: true, duplicate: true });
    if (prev?.status === 'processing' && Date.now() - new Date(prev.received_at).getTime() < STALE_MS)
      return NextResponse.json({ error: 'Already being processed' }, { status: 409 }); // Stripe retries later
    await admin.from('stripe_events').update({ status: 'processing', attempts: (prev?.attempts ?? 1) + 1, received_at: new Date().toISOString(), error: null }).eq('id', event.id);
  }

  try {
    const { orgId, handled } = await handle(event);
    await admin.from('stripe_events').update({ status: handled ? 'processed' : 'ignored', org_id: orgId, processed_at: new Date().toISOString() }).eq('id', event.id);
    return NextResponse.json({ received: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('stripe webhook failed', event.type, event.id, msg);
    await admin.from('stripe_events').update({ status: 'failed', error: msg.slice(0, 1000) }).eq('id', event.id);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

async function handle(event: Stripe.Event): Promise<{ orgId: string | null; handled: boolean }> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      const s = event.data.object;
      if (s.mode !== 'subscription') return { orgId: null, handled: false };
      const org = await orgForStripe(idOf(s.customer), s.client_reference_id ?? s.metadata?.org_id);
      if (!org) throw new Error(`no organization for checkout session ${s.id}`);
      const subId = idOf(s.subscription);
      if (subId) await syncSubscription(org, subId, 'Stripe checkout');
      if (event.type === 'checkout.session.async_payment_failed') await paymentFailed(org, 'The payment for your subscription failed.');
      return { orgId: org.id, handled: true };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.pending_update_applied':
    case 'customer.subscription.pending_update_expired': {
      const sub = event.data.object;
      const org = await orgForStripe(idOf(sub.customer), sub.metadata?.org_id);
      if (!org) throw new Error(`no organization for subscription ${sub.id}`);
      await syncSubscription(org, sub.id, 'Stripe');
      return { orgId: org.id, handled: true };
    }

    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required':
    case 'invoice.finalized':
    case 'invoice.updated':
    case 'invoice.voided':
    case 'invoice.marked_uncollectible': {
      const inv = event.data.object;
      const org = await orgForStripe(idOf(inv.customer), inv.subscription_details?.metadata?.org_id ?? inv.metadata?.org_id);
      if (!org) {
        // invoices of customers we do not know (e.g. created by hand in the dashboard): nothing to update
        return { orgId: null, handled: false };
      }
      await recordInvoice(org, inv);
      const subId = idOf(inv.subscription);
      if (subId && event.type !== 'invoice.finalized' && event.type !== 'invoice.updated') await syncSubscription(org, subId, 'Stripe invoice');
      if (event.type === 'invoice.paid') {
        await supabaseAdmin().from('organizations').update({ last_payment_error: null }).eq('id', org.id);
        await audit({ orgId: org.id, actorName: 'Stripe', action: 'billing.payment_succeeded', target: { type: 'invoice', id: inv.id, label: inv.number }, details: { amount_paid: inv.amount_paid, currency: inv.currency, reason: inv.billing_reason } });
      }
      if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_action_required') {
        const why = event.type === 'invoice.payment_action_required'
          ? 'Your bank needs you to confirm the payment.'
          : (typeof inv.payment_intent === 'object' && inv.payment_intent?.last_payment_error?.message) || 'The card was declined or could not be charged.';
        await paymentFailed(org, why, inv);
      }
      return { orgId: org.id, handled: true };
    }

    case 'customer.deleted': {
      const c = event.data.object;
      const org = await orgForStripe(c.id, c.metadata?.org_id);
      if (!org) return { orgId: null, handled: false };
      await supabaseAdmin().from('organizations').update({
        stripe_customer_id: null, stripe_subscription_id: null, stripe_items: [], addons: [],
        ...(org.status === 'suspended' ? {} : { status: 'canceled' }),
      }).eq('id', org.id);
      return { orgId: org.id, handled: true };
    }

    default:
      return { orgId: null, handled: false };
  }
}

async function paymentFailed(org: Org, why: string, inv?: Stripe.Invoice) {
  await supabaseAdmin().from('organizations').update({ last_payment_failed_at: new Date().toISOString(), last_payment_error: why.slice(0, 500) }).eq('id', org.id);
  await audit({ orgId: org.id, actorName: 'Stripe', action: 'billing.payment_failed', target: { type: 'invoice', id: inv?.id ?? null, label: inv?.number ?? null }, details: { reason: why, attempt: inv?.attempt_count ?? null, next_attempt: inv?.next_payment_attempt ?? null } });
  await emailPaymentFailed(org, why, inv?.hosted_invoice_url ?? null);
}
