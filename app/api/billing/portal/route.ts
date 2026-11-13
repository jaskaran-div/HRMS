import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { stripe, stripeConfigured, liveMode } from '@/lib/stripe';
import { baseUrl } from '@/lib/platform-mail';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Owner only: opens Stripe's customer portal (cards, invoices, cancel / resume). Configure it in the Stripe Dashboard. */
export async function POST(req: Request) {
  const g = await guard(['owner'], { allowLocked: true });
  if (!g.ok) return g.response;
  if (!stripeConfigured()) return NextResponse.json({ error: 'Online payment is not set up.' }, { status: 503 });
  if (!g.org.stripe_customer_id || g.org.stripe_livemode !== liveMode()) return NextResponse.json({ error: 'There is no billing account yet. Subscribe first.' }, { status: 409 });
  try {
    const s = await stripe().billingPortal.sessions.create({ customer: g.org.stripe_customer_id, return_url: `${baseUrl(req)}/billing` });
    await audit({ orgId: g.org.id, actor: g.profile, action: 'billing.portal_opened' });
    return NextResponse.json({ url: s.url });
  } catch (e) {
    console.error('portal failed', e);
    return NextResponse.json({ error: 'Could not open the billing portal.' }, { status: 502 });
  }
}
