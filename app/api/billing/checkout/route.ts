import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { guard, clientIp } from '@/lib/auth';
import { planLineItem, stripe, stripeConfigProblems } from '@/lib/stripe';
import { ensureCustomer } from '@/lib/billing/sync';
import { readCheckoutToken } from '@/lib/billing/checkout-token';
import { rateLimit } from '@/lib/rate-limit';
import { orgById } from '@/lib/tenant';
import { baseUrl } from '@/lib/platform-mail';
import type { Org } from '@/lib/org';

export const dynamic = 'force-dynamic';

const LIVE_SUB = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

/**
 * Starts Stripe Checkout for the plan. Called by the logged-in owner (Billing), or right after registration with
 * the signed { token } the registration returned. Nothing is unlocked here or on the success redirect — only a
 * payment confirmed by Stripe (webhook, or the success page re-reading the session from Stripe) activates it.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { token?: unknown };
  let org: Org | null;
  let email: string | null;
  if (b.token !== undefined) {
    const ip = (await clientIp()) ?? 'unknown';
    if (!rateLimit(`checkout:${ip}`, 20, 3600_000)) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    const id = readCheckoutToken(b.token);
    org = id ? await orgById(id) : null;
    if (!org) return NextResponse.json({ error: 'This payment link has expired. Log in to subscribe from Billing.', relogin: true }, { status: 401 });
    email = org.owner_email;
  } else {
    const g = await guard(['owner'], { allowLocked: true });
    if (!g.ok) return g.response;
    org = g.org;
    email = g.user.email ?? org.owner_email;
  }

  const problems = stripeConfigProblems();
  if (problems.length) return NextResponse.json({ error: 'Online payment is not set up yet. Contact Sales to activate your organization.', detail: process.env.NODE_ENV === 'production' ? undefined : problems }, { status: 503 });
  if (org.billing_exempt) return NextResponse.json({ error: 'Your organization is on a managed plan; no payment is needed.' }, { status: 400 });
  if (org.status === 'suspended') return NextResponse.json({ error: 'This organization is suspended. Contact support.' }, { status: 403 });
  if (org.stripe_subscription_id && org.stripe_subscription_status && LIVE_SUB.has(org.stripe_subscription_status))
    return NextResponse.json({ error: 'You already have a subscription. Manage it in Billing.' }, { status: 409 });

  try {
    const customer = await ensureCustomer(org, email);
    const url = baseUrl(req);
    const item = planLineItem();
    // the same click twice within 10 minutes → the same session, not two
    const key = createHash('sha256').update(`${org.id}|${item.price ?? 'inline'}|${Math.floor(Date.now() / 600_000)}`).digest('hex');
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription', customer, client_reference_id: org.id, line_items: [item],
      metadata: { org_id: org.id }, subscription_data: { metadata: { org_id: org.id } },
      allow_promotion_codes: true, billing_address_collection: 'auto',
      customer_update: { address: 'auto', name: 'auto' },
      success_url: `${url}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${url}/billing/failed?reason=cancelled`,
    }, { idempotencyKey: `checkout-${key}` });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('checkout failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }
}
