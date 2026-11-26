import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { stripe, stripeConfigured } from '@/lib/stripe';
import { syncSubscription } from '@/lib/billing/sync';

export const dynamic = 'force-dynamic';

/**
 * Owner only: cancel at the end of the paid period ({ resume: false }), or undo that ({ resume: true }).
 * Access continues until the period end either way; Stripe sends no further invoice after a cancellation.
 */
export async function POST(req: Request) {
  const g = await guard(['owner'], { allowLocked: true });
  if (!g.ok) return g.response;
  if (!stripeConfigured()) return NextResponse.json({ error: 'Online payment is not set up.' }, { status: 503 });
  const org = g.org;
  if (!org.stripe_subscription_id || !['active', 'trialing', 'past_due'].includes(org.stripe_subscription_status ?? ''))
    return NextResponse.json({ error: 'There is no active subscription to change.' }, { status: 409 });
  const { resume } = (await req.json().catch(() => ({}))) as { resume?: boolean };
  try {
    await stripe().subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: !resume });
    await syncSubscription(org, org.stripe_subscription_id, `${g.profile.full_name} (${resume ? 'resume' : 'cancel'})`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('cancel / resume failed', e);
    return NextResponse.json({ error: 'Could not change the subscription. Please try again.' }, { status: 502 });
  }
}
