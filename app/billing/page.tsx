import Link from 'next/link';
import { redirect } from 'next/navigation';
import { webSession } from '@/lib/web-session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { addonPrices, basePriceId, priceInfo, stripeConfigured } from '@/lib/stripe';
import { ADDONS, BASE_FEATURES, FEATURE_LABEL } from '@/lib/billing/catalog';
import { orgHasAccess, STATUS_LABEL, summarize } from '@/lib/org';
import { BillingClient, type Offer, type InvoiceRow } from './BillingClient';

export const dynamic = 'force-dynamic';

/** Web-only billing: plan + add-ons (Stripe Checkout), subscription management, invoices. Owner manages; admins may look. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const s = await webSession();
  const { org, profile } = s;
  if (profile.role !== 'owner' && profile.role !== 'admin') redirect(orgHasAccess(org) ? '/' : '/locked');
  const { checkout } = await searchParams;

  const ready = stripeConfigured();
  let offer: Offer | null = null;
  if (ready) {
    const addons = addonPrices();
    const info = await priceInfo([basePriceId(), ...addons.values()]);
    const p = (id: string) => { const x = info.get(id); return x ? { amount: x.amount, currency: x.currency, interval: x.interval } : null; };
    offer = {
      base: { features: BASE_FEATURES.map(f => FEATURE_LABEL[f]), price: p(basePriceId()) },
      addons: ADDONS.filter(a => addons.has(a.feature)).map(a => ({ feature: a.feature, name: a.name, description: a.description, price: p(addons.get(a.feature)!) })),
    };
  }
  const { data: invoices } = await supabaseAdmin().from('billing_invoices')
    .select('id, number, status, billing_reason, currency, amount_due, amount_paid, hosted_invoice_url, invoice_pdf, period_start, period_end, paid_at, created_at, last_error, attempt_count')
    .eq('org_id', org.id).order('created_at', { ascending: false }).limit(36);

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
        offer={offer}
        stripeReady={ready}
        checkout={checkout ?? null}
        invoices={(invoices ?? []) as InvoiceRow[]}
      />
    </div>
  );
}
