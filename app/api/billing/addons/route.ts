import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { addonPrices, stripe, stripeConfigured } from '@/lib/stripe';
import { syncSubscription } from '@/lib/billing/sync';
import { isFeature } from '@/lib/billing/catalog';

export const dynamic = 'force-dynamic';

/**
 * Owner only: change the add-ons on the existing subscription. Body: { addons: Feature[] } (the full wanted list)
 *  - removed add-ons: taken off now, credited on the next invoice (proration);
 *  - added add-ons: charged now (prorated). Stripe applies them ONLY if that payment succeeds
 *    (payment_behavior=pending_if_incomplete), so a failed card never unlocks a feature.
 */
export async function POST(req: Request) {
  const g = await guard(['owner']);
  if (!g.ok) return g.response;
  if (!stripeConfigured()) return NextResponse.json({ error: 'Online payment is not set up.' }, { status: 503 });
  const org = g.org;
  if (!org.stripe_subscription_id || !['active', 'trialing', 'past_due'].includes(org.stripe_subscription_status ?? ''))
    return NextResponse.json({ error: 'Add-ons can be changed on an active subscription only.' }, { status: 409 });
  if (org.status === 'past_due') return NextResponse.json({ error: 'Settle the overdue payment first, then change add-ons.' }, { status: 409 });

  const b = (await req.json().catch(() => ({}))) as { addons?: unknown };
  const prices = addonPrices();
  const wanted = new Set(Array.isArray(b.addons) ? b.addons.filter(isFeature).filter(f => prices.has(f)) : []);
  const s = stripe();
  const sub = await s.subscriptions.retrieve(org.stripe_subscription_id, { expand: ['items.data.price'] });
  const priceToFeature = new Map([...prices].map(([f, p]) => [p, f]));
  const current = sub.items.data.filter(i => priceToFeature.has(i.price.id));
  const remove = current.filter(i => !wanted.has(priceToFeature.get(i.price.id)!));
  const have = new Set(current.map(i => priceToFeature.get(i.price.id)!));
  const add = [...wanted].filter(f => !have.has(f));
  if (!remove.length && !add.length) return NextResponse.json({ ok: true, unchanged: true });

  try {
    if (remove.length)
      await s.subscriptions.update(sub.id, { items: remove.map(i => ({ id: i.id, deleted: true })), proration_behavior: 'create_prorations' });
    let pending = false;
    if (add.length) {
      const updated = await s.subscriptions.update(sub.id, {
        items: add.map(f => ({ price: prices.get(f)!, quantity: 1 })),
        proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete',
      });
      pending = !!updated.pending_update;
    }
    await syncSubscription(org, sub.id, `${g.profile.full_name} (add-ons)`);
    return NextResponse.json({ ok: true, pending,
      message: pending ? 'The new add-ons start as soon as the payment is confirmed. Check Billing for an invoice that needs action.' : 'Add-ons updated.' });
  } catch (e) {
    console.error('addon change failed', e);
    const msg = e instanceof Error && 'type' in e && (e as { type?: string }).type === 'StripeCardError' ? (e as Error).message : 'Could not change add-ons. Nothing was charged for the failed part.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
