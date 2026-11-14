import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { guard } from '@/lib/auth';
import { addonPrices, basePriceId, stripe, stripeConfigProblems } from '@/lib/stripe';
import { ensureCustomer } from '@/lib/billing/sync';
import { isFeature } from '@/lib/billing/catalog';
import { baseUrl } from '@/lib/platform-mail';

export const dynamic = 'force-dynamic';

const LIVE_SUB = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

/**
 * Owner only: starts Stripe Checkout for the base plan + chosen add-ons. Body: { addons: Feature[] }
 * Nothing is unlocked here or on the success redirect — only the verified webhook activates the organization.
 */
export async function POST(req: Request) {
  const g = await guard(['owner'], { allowLocked: true });
  if (!g.ok) return g.response;
  const problems = stripeConfigProblems();
  if (problems.length) return NextResponse.json({ error: 'Online payment is not set up yet. Contact Sales to activate your organization.', detail: process.env.NODE_ENV === 'production' ? undefined : problems }, { status: 503 });
  const org = g.org;
  if (org.billing_exempt) return NextResponse.json({ error: 'Your organization is on a managed plan; no payment is needed.' }, { status: 400 });
  if (org.status === 'suspended') return NextResponse.json({ error: 'This organization is suspended. Contact support.' }, { status: 403 });
  if (org.stripe_subscription_id && org.stripe_subscription_status && LIVE_SUB.has(org.stripe_subscription_status))
    return NextResponse.json({ error: 'You already have a subscription. Manage add-ons or payment in Billing instead.' }, { status: 409 });

  const b = (await req.json().catch(() => ({}))) as { addons?: unknown };
  const prices = addonPrices();
  const wanted = [...new Set(Array.isArray(b.addons) ? b.addons.filter(isFeature) : [])].filter(f => prices.has(f));
  const lineItems = [{ price: basePriceId(), quantity: 1 }, ...wanted.map(f => ({ price: prices.get(f)!, quantity: 1 }))];

  try {
    const customer = await ensureCustomer(org, g.user.email ?? org.owner_email);
    const url = baseUrl(req);
    // same choice clicked twice within 10 minutes → the same session, not two
    const key = createHash('sha256').update(`${org.id}|${lineItems.map(l => l.price).join(',')}|${Math.floor(Date.now() / 600_000)}`).digest('hex');
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription', customer, client_reference_id: org.id, line_items: lineItems,
      metadata: { org_id: org.id }, subscription_data: { metadata: { org_id: org.id } },
      allow_promotion_codes: true, billing_address_collection: 'auto',
      customer_update: { address: 'auto', name: 'auto' },
      success_url: `${url}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${url}/billing?checkout=cancelled`,
    }, { idempotencyKey: `checkout-${key}` });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('checkout failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }
}
