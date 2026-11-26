import Link from 'next/link';
import { redirect } from 'next/navigation';
import { webSession } from '@/lib/web-session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { planPrice, stripeConfigured } from '@/lib/stripe';
import { orgHasAccess, STATUS_LABEL, summarize } from '@/lib/org';
import { BillingClient, type InvoiceRow, type Tracking } from './BillingClient';

export const dynamic = 'force-dynamic';

/** Web-only billing: subscribe (Stripe Checkout), plan tracking, cancel / resume, features, invoices. Owner manages; admins may look. */
export default async function BillingPage() {
  const s = await webSession();
  const { org, profile } = s;
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect(orgHasAccess(org) ? '/' : '/locked');

  const ready = stripeConfigured();
  const [price, { data: invoices }] = await Promise.all([
    planPrice().catch(() => undefined),
    supabaseAdmin().from('billing_invoices')
      .select('id, number, status, billing_reason, currency, amount_due, amount_paid, hosted_invoice_url, invoice_pdf, period_start, period_end, paid_at, created_at, last_error, attempt_count')
      .eq('org_id', org.id).order('created_at', { ascending: false }).limit(60),
  ]);
  const rows = (invoices ?? []) as InvoiceRow[];
  const paid = rows.filter(i => i.status === 'paid');
  const item = org.stripe_items?.[0];
  const tracking: Tracking = {
    startedAt: org.subscription_started_at,
    periodStart: org.current_period_start,
    periodEnd: org.current_period_end,
    cancelAtPeriodEnd: org.cancel_at_period_end,
    endedAt: org.ended_at,
    paymentMethod: org.payment_method,
    subStatus: org.stripe_subscription_status,
    totalPaid: paid.reduce((n, i) => n + (i.amount_paid ?? 0), 0),
    payments: paid.length,
    currency: paid[0]?.currency ?? item?.currency ?? price?.currency ?? 'inr',
    recurring: item?.amount != null && item.currency ? { amount: item.amount, currency: item.currency, interval: item.interval ?? 'month' } : null,
  };

  return (
    <div className="solo">
      <div className="solo-top">
        <h1>Billing — {org.name}</h1>
        <span className="pill gray">{STATUS_LABEL[org.status]}</span>
        <span className="sp" />
        {orgHasAccess(org) && <Link className="btn" href="/">Back to the HR portal</Link>}
        <form action="/api/logout" method="post"><button className="btn">Log out</button></form>
      </div>
      <BillingClient
        isOwner={profile.role === 'owner'}
        org={summarize(org)}
        exempt={org.billing_exempt}
        hasSubscription={!!org.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(org.stripe_subscription_status ?? '')}
        lastError={org.last_payment_error}
        price={price}
        stripeReady={ready}
        tracking={tracking}
        disabled={(org.disabled_features ?? []) as string[]}
        revoked={org.entitlement_overrides?.revoke ?? []}
        invoices={rows}
      />
    </div>
  );
}
