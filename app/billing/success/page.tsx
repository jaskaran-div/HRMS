import Link from 'next/link';
import { redirect } from 'next/navigation';
import type Stripe from 'stripe';
import { Icon } from '@/components/Icon';
import { stripe, stripeConfigured } from '@/lib/stripe';
import { idOf, orgForStripe, recordInvoice, syncSubscription } from '@/lib/billing/sync';
import { orgHasAccess, type Org } from '@/lib/org';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fmtDate } from '@/lib/dates';
import { money } from '@/lib/money';
import { PLAN } from '@/lib/billing/catalog';
import { ResendVerification } from '@/app/verify-email/ResendVerification';

export const dynamic = 'force-dynamic';

const mask = (e: string | null) => (e ? e.replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => a + '•'.repeat(Math.min(b.length, 6)) + c) : 'your email');

/**
 * Where Stripe Checkout returns after payment. The session is re-read from the Stripe API (the redirect alone
 * proves nothing) and the subscription synced, so the organization is active even before the webhook arrives.
 */
export default async function CheckoutSuccess({ searchParams }: { searchParams: Promise<{ session_id?: string; n?: string }> }) {
  const { session_id, n } = await searchParams;
  if (!session_id || !/^cs_[A-Za-z0-9_]+$/.test(session_id) || !stripeConfigured()) redirect('/billing/failed?reason=unknown');

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(session_id, { expand: ['invoice'] });
  } catch {
    redirect('/billing/failed?reason=unknown');
  }
  if (session.status === 'expired') redirect('/billing/failed?reason=expired');
  if (session.status === 'open') redirect('/billing/failed?reason=incomplete');

  const found = await orgForStripe(idOf(session.customer), session.client_reference_id ?? session.metadata?.org_id);
  if (!found) redirect('/billing/failed?reason=unknown');
  let org: Org = found;
  const subId = idOf(session.subscription);
  try {
    if (subId) await syncSubscription(org, subId, 'Checkout success page');
    if (session.invoice && typeof session.invoice === 'object') await recordInvoice(org, session.invoice);
  } catch (e) { console.error('success page sync failed (the webhook will catch up)', e); }
  // read fresh after the sync (orgById is cached per request)
  const { data: fresh } = await supabaseAdmin().from('organizations').select('*').eq('id', org.id).maybeSingle();
  if (fresh) org = fresh as Org;

  const paid = orgHasAccess(org);
  const tries = Number(n) || 0;
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  const loggedIn = !!user && user.id === org.owner_user_id;
  const invoice = typeof session.invoice === 'object' ? session.invoice : null;

  if (!paid) return (
    <div className="login-wrap">
      {tries < 20 && <meta httpEquiv="refresh" content={`4;url=/billing/success?session_id=${session_id}&n=${tries + 1}`} />}
      <div className="public-card">
        <div className="result-icon wait"><Icon name="clock" size={28} /></div>
        <h1>Confirming your payment…</h1>
        <p className="sub">
          {session.payment_status === 'unpaid'
            ? 'Your bank is still processing the payment. This page updates by itself; you will also get an email from Stripe once it is through.'
            : 'Stripe is confirming the payment. This usually takes a few seconds.'}
        </p>
        {tries >= 20 && <p className="note">Still waiting. You can safely close this page: your organization switches on as soon as the payment is confirmed. <Link href="/contact-sales">Contact us</Link> if it doesn’t within an hour.</p>}
      </div>
    </div>
  );

  return (
    <div className="login-wrap">
      <div className="public-card">
        <div className="result-icon ok"><Icon name="check" size={30} /></div>
        <h1>Payment successful</h1>
        <p className="sub">{org.name} is now on the {PLAN.name} plan. A receipt is on its way from Stripe.</p>
        <dl className="kv" style={{ marginBottom: 18 }}>
          <dt>Plan</dt><dd>{PLAN.name} — unlimited employees, every feature</dd>
          <dt>Amount paid</dt><dd>{money(invoice?.amount_paid ?? session.amount_total, session.currency)}</dd>
          {org.current_period_start && <><dt>Paid period</dt><dd>{fmtDate(org.current_period_start.slice(0, 10))} – {org.current_period_end ? fmtDate(org.current_period_end.slice(0, 10)) : ''}</dd></>}
          {org.current_period_end && <><dt>Next renewal</dt><dd>{fmtDate(org.current_period_end.slice(0, 10))}</dd></>}
          {org.payment_method && <><dt>Paid with</dt><dd>{org.payment_method}</dd></>}
        </dl>
        {invoice?.hosted_invoice_url && <p><a href={invoice.hosted_invoice_url} target="_blank" rel="noreferrer">View invoice / receipt</a></p>}

        {loggedIn ? (
          <Link className="btn primary" href={org.onboarded_at ? '/' : '/onboarding'}>{org.onboarded_at ? 'Open the HR portal' : 'Set up your organization'}</Link>
        ) : org.email_verified_at ? (
          <Link className="btn primary" href="/login">Log in</Link>
        ) : (
          <>
            <p className="note">One last step: open the verification link we sent to <b>{mask(org.owner_email)}</b>, then log in.</p>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <ResendVerification email="" />
              <Link className="btn" href="/login">Go to login</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
