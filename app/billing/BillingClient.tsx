'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { STATUS_LABEL, type OrgSummary } from '@/lib/org';
import { FEATURE_LABEL, type Feature } from '@/lib/billing/catalog';
import { money } from '@/lib/money';

type Price = { amount: number | null; currency: string; interval: string | null } | null;
export interface Offer {
  base: { features: string[]; price: Price };
  addons: { feature: Feature; name: string; description: string; price: Price }[];
}
export interface InvoiceRow {
  id: string; number: string | null; status: string | null; billing_reason: string | null; currency: string | null;
  amount_due: number | null; amount_paid: number | null; hosted_invoice_url: string | null; invoice_pdf: string | null;
  period_start: string | null; period_end: string | null; paid_at: string | null; created_at: string; last_error: string | null; attempt_count: number | null;
}

const priceText = (p: Price) => (p ? <>{money(p.amount, p.currency)}{p.interval && <small> / {p.interval}</small>}</> : <small>price unavailable</small>);

async function post(url: string, body?: object) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Something went wrong');
  return j;
}

export function BillingClient({ isOwner, org: initial, exempt, hasSubscription, lastError, offer, stripeReady, checkout, invoices }: {
  isOwner: boolean; org: OrgSummary; exempt: boolean; hasSubscription: boolean; lastError: string | null; offer: Offer | null;
  stripeReady: boolean; checkout: string | null; invoices: InvoiceRow[];
}) {
  const [org, setOrg] = useState(initial);
  const [pick, setPick] = useState<Set<Feature>>(() => new Set(initial.features.filter(f => offer?.addons.some(a => a.feature === f))));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [waiting, setWaiting] = useState(checkout === 'success' && !initial.access);

  // after Stripe Checkout: wait for the webhook to confirm payment (the redirect itself proves nothing)
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const t = setInterval(async () => {
      n++;
      const r = await fetch('/api/billing/status').then(x => x.json()).catch(() => null);
      if (r?.org) setOrg(r.org);
      if (r?.org?.access) { clearInterval(t); setWaiting(false); window.location.replace(r.org.onboarded ? '/' : '/onboarding'); }
      if (n > 60) { clearInterval(t); setWaiting(false); setMessage('Payment is still being confirmed. This page updates when Stripe confirms it — you will also get an email receipt from Stripe.'); }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting]);

  const toggle = (f: Feature) => setPick(p => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what); setError(''); setMessage('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  }
  const subscribe = () => run('checkout', async () => { const j = await post('/api/billing/checkout', { addons: [...pick] }); window.location.href = j.url; });
  const portal = () => run('portal', async () => { const j = await post('/api/billing/portal'); window.location.href = j.url; });
  const saveAddons = () => run('addons', async () => { const j = await post('/api/billing/addons', { addons: [...pick] }); setMessage(j.message ?? 'Saved'); setTimeout(() => window.location.reload(), 1500); });

  const total = offer ? [offer.base.price, ...offer.addons.filter(a => pick.has(a.feature)).map(a => a.price)] : [];
  const sameCurrency = total.every(p => p && p.currency === total[0]?.currency && p.interval === total[0]?.interval);
  const sum = sameCurrency ? total.reduce((n, p) => n + (p?.amount ?? 0), 0) : null;

  return (
    <>
      {checkout === 'cancelled' && <div className="note" style={{ marginBottom: 12 }}>Checkout was cancelled — nothing was charged.</div>}
      {waiting && <div className="note" style={{ marginBottom: 12 }}><Spinner size={14} /> Confirming your payment with Stripe… this usually takes a few seconds.</div>}
      {message && <div className="note ok" style={{ marginBottom: 12 }}>{message}</div>}
      {error && <div className="note bad" style={{ marginBottom: 12 }}>{error}</div>}
      {org.pastDue && <div className="note warn" style={{ marginBottom: 12 }}>The last payment failed{lastError ? `: ${lastError}` : ''}. Stripe retries automatically; update your card in “Manage payment & invoices” to keep access.</div>}

      <div className="card">
        <h3>Subscription</h3>
        <dl className="kv">
          <dt>Status</dt><dd>{STATUS_LABEL[org.status]}{exempt && ' (managed plan — no payment needed)'}</dd>
          <dt>Features</dt><dd>{org.features.length ? org.features.map(f => FEATURE_LABEL[f]).join(', ') : '—'}</dd>
          {org.periodEnd && <><dt>{org.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}</dt><dd>{fmtDate(org.periodEnd.slice(0, 10))}</dd></>}
        </dl>
        {org.cancelAtPeriodEnd && <p className="note warn" style={{ marginTop: 12 }}>The subscription is cancelled and ends on {org.periodEnd ? fmtDate(org.periodEnd.slice(0, 10)) : 'the period end'}. Resume it in “Manage payment & invoices”.</p>}
        {!isOwner && <p className="muted small">Only the owner can change the subscription.</p>}
        {isOwner && hasSubscription && stripeReady && (
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn" onClick={portal} disabled={!!busy}>{busy === 'portal' ? 'Opening…' : 'Manage payment & invoices'}</button>
            <span className="muted small">Card, billing details, invoices, cancel or resume — on Stripe’s secure page.</span>
          </div>
        )}
      </div>

      {!exempt && isOwner && !stripeReady && (
        <div className="card"><p className="note warn">Online payment is not set up on this server yet. <Link href="/contact-sales">Contact Sales</Link> to activate your organization.</p></div>
      )}

      {!exempt && isOwner && offer && (
        <div className="card">
          <h3>{hasSubscription ? 'Add-ons' : 'Choose your plan'}</h3>
          <div className="plans">
            <div className="plan on">
              <h4>Base plan</h4>
              <div className="price">{priceText(offer.base.price)}</div>
              <ul>{offer.base.features.map(f => <li key={f}>{f}</li>)}</ul>
              <span className="pill ok">Included</span>
            </div>
            {offer.addons.map(a => (
              <label key={a.feature} className={`plan ${pick.has(a.feature) ? 'on' : ''}`} style={{ cursor: 'pointer' }}>
                <h4><input type="checkbox" checked={pick.has(a.feature)} onChange={() => toggle(a.feature)} /> {a.name}</h4>
                <div className="price">{priceText(a.price)}</div>
                <span className="muted small">{a.description}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 16, marginBottom: 0 }}>
            {!hasSubscription && <>
              <button className="btn primary" onClick={subscribe} disabled={!!busy || waiting}>{busy === 'checkout' ? 'Opening Stripe…' : 'Continue to secure payment'}</button>
              {sum != null && <span className="muted small">Total {money(sum, total[0]?.currency)}{total[0]?.interval ? ` / ${total[0].interval}` : ''} + applicable taxes</span>}
            </>}
            {hasSubscription && <>
              <button className="btn primary" onClick={saveAddons} disabled={!!busy || org.pastDue}>{busy === 'addons' ? 'Saving…' : 'Update add-ons'}</button>
              <span className="muted small">New add-ons are charged now (prorated) and switch on once paid; removed ones are credited on the next invoice.</span>
            </>}
          </div>
        </div>
      )}

      <div className="card">
        <h3>Payment history</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Date</th><th>Invoice</th><th>Period</th><th>Amount</th><th>Status</th><th /></tr></thead>
            <tbody>
              {invoices.map(i => (
                <tr key={i.id}>
                  <td>{fmtDate((i.paid_at ?? i.created_at).slice(0, 10))}</td>
                  <td>{i.number ?? '—'}<div className="muted small">{(i.billing_reason ?? '').replace(/_/g, ' ')}</div></td>
                  <td>{i.period_start && i.period_end ? `${fmtDate(i.period_start.slice(0, 10))} – ${fmtDate(i.period_end.slice(0, 10))}` : '—'}</td>
                  <td>{money(i.status === 'paid' ? i.amount_paid : i.amount_due, i.currency)}</td>
                  <td><span className={`pill ${i.status === 'paid' ? 'ok' : i.status === 'open' ? 'warn' : 'gray'}`}>{i.status ?? '—'}</span>
                    {i.last_error && i.status !== 'paid' && <div className="err small">{i.last_error}</div>}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {i.hosted_invoice_url && <a className="btn sm" href={i.hosted_invoice_url} target="_blank" rel="noreferrer">{i.status === 'open' ? 'Pay' : 'View'}</a>}{' '}
                    {i.invoice_pdf && <a className="btn sm" href={i.invoice_pdf} target="_blank" rel="noreferrer">PDF</a>}
                  </td>
                </tr>
              ))}
              {!invoices.length && <tr><td colSpan={6} className="muted">No payments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
