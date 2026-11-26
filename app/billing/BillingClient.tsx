'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Spinner } from '@/components/ui';
import { PricingCard, planAmount, type PlanPrice } from '@/components/PricingCard';
import { fmtDate } from '@/lib/dates';
import { STATUS_LABEL, type OrgSummary } from '@/lib/org';
import { FEATURE_DESCRIPTION, FEATURE_LABEL, OPTIONAL_FEATURES, PLAN, type Feature } from '@/lib/billing/catalog';
import { money } from '@/lib/money';
import { startCheckout } from '@/lib/billing/start-checkout';

export interface InvoiceRow {
  id: string; number: string | null; status: string | null; billing_reason: string | null; currency: string | null;
  amount_due: number | null; amount_paid: number | null; hosted_invoice_url: string | null; invoice_pdf: string | null;
  period_start: string | null; period_end: string | null; paid_at: string | null; created_at: string; last_error: string | null; attempt_count: number | null;
}
export interface Tracking {
  startedAt: string | null; periodStart: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean; endedAt: string | null;
  paymentMethod: string | null; subStatus: string | null; totalPaid: number; payments: number; currency: string;
  recurring: PlanPrice | null;
}

const d = (iso: string | null) => (iso ? fmtDate(iso.slice(0, 10)) : '—');
const DAY = 86_400_000;
const REASON: Record<string, string> = { subscription_create: 'First payment', subscription_cycle: 'Monthly renewal', subscription_update: 'Plan change', manual: 'Manual' };

async function post(url: string, body?: object) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Something went wrong');
  return j;
}

export function BillingClient({ isOwner, org, exempt, hasSubscription, lastError, price, stripeReady, tracking: t, disabled: initialDisabled, revoked, invoices }: {
  isOwner: boolean; org: OrgSummary; exempt: boolean; hasSubscription: boolean; lastError: string | null; price?: PlanPrice;
  stripeReady: boolean; tracking: Tracking; disabled: string[]; revoked: string[]; invoices: InvoiceRow[];
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [disabled, setDisabled] = useState(() => new Set(initialDisabled));
  const [savedDisabled, setSavedDisabled] = useState(() => [...initialDisabled].sort().join());

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what); setError(''); setMessage('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  }
  const subscribe = () => run('checkout', async () => { const e = await startCheckout(); if (e) throw new Error(e); });
  const portal = () => run('portal', async () => { const j = await post('/api/billing/portal'); window.location.href = j.url; });
  const cancel = (resume: boolean) => {
    if (!resume && !confirm(`Cancel the subscription? You keep full access until ${d(t.periodEnd)}; nothing is charged after that.`)) return;
    run(resume ? 'resume' : 'cancel', async () => { await post('/api/billing/cancel', { resume }); window.location.reload(); });
  };
  const saveFeatures = () => run('features', async () => {
    const j = await post('/api/org/features', { disabled: [...disabled] });
    setSavedDisabled([...j.disabled].sort().join());
    setMessage('Features saved. Everyone sees the change the next time they open a page or the app.');
  });
  const toggle = (f: Feature, on: boolean) => setDisabled(s => { const n = new Set(s); if (on) n.delete(f); else n.add(f); return n; });
  const featuresChanged = [...disabled].sort().join() !== savedDisabled;

  // where we are in the paid month
  const start = t.periodStart ? new Date(t.periodStart).getTime() : null;
  const end = t.periodEnd ? new Date(t.periodEnd).getTime() : null;
  const now = Date.now();
  const pct = start && end && end > start ? Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100))) : null;
  const daysLeft = end ? Math.max(0, Math.ceil((end - now) / DAY)) : null;
  const recurring = t.recurring ?? price ?? null;
  const live = hasSubscription && (org.status === 'active' || org.status === 'past_due');

  return (
    <>
      {message && <div className="note ok" style={{ marginBottom: 12 }}>{message}</div>}
      {error && <div className="note bad" style={{ marginBottom: 12 }}>{error}</div>}
      {org.pastDue && <div className="note warn" style={{ marginBottom: 12 }}>The last payment failed{lastError ? `: ${lastError}` : ''}. Stripe retries automatically; update your card in “Payment method & invoices” to keep access.</div>}

      {/* ---- not subscribed yet: the plan ---- */}
      {!exempt && !hasSubscription && (
        <div className="card">
          <h3>{org.status === 'canceled' || org.status === 'expired' ? 'Subscribe again' : 'Choose your plan'}</h3>
          {!isOwner && <p className="muted small">Only the owner can subscribe.</p>}
          {isOwner && !stripeReady && <p className="note warn">Online payment is not set up on this server yet. <Link href="/contact-sales">Contact Sales</Link> to activate your organization.</p>}
          <div style={{ maxWidth: 460 }}>
            <PricingCard price={price} compact>
              {isOwner && <button className="btn primary" onClick={subscribe} disabled={!!busy || !stripeReady}>{busy === 'checkout' ? <><Spinner size={16} /> Opening secure payment…</> : 'Subscribe & pay'}</button>}
            </PricingCard>
          </div>
        </div>
      )}

      {/* ---- the subscription and where it stands ---- */}
      {(exempt || hasSubscription) && (
        <div className="card">
          <div className="row" style={{ marginBottom: 0, alignItems: 'baseline' }}>
            <h3 style={{ margin: 0 }}>{exempt ? 'Managed plan' : `${PLAN.name} plan`}</h3>
            {!exempt && recurring && <b>{planAmount(recurring)}<span className="muted small"> / {recurring.interval}</span></b>}
            <span className={`pill ${org.status === 'active' ? (t.cancelAtPeriodEnd ? 'warn' : 'ok') : org.pastDue ? 'warn' : 'gray'}`}>
              {t.cancelAtPeriodEnd && org.status === 'active' ? 'Cancelling' : STATUS_LABEL[org.status]}
            </span>
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>{exempt ? 'Everything is unlocked; no payment is needed.' : 'Unlimited employees and every feature.'}</p>

          {!exempt && <>
            <div className="plan-track">
              <div><span>Subscribed since</span><b>{d(t.startedAt)}</b></div>
              <div><span>Current period</span><b>{t.periodStart && t.periodEnd ? `${d(t.periodStart)} – ${d(t.periodEnd)}` : '—'}</b></div>
              <div><span>{t.cancelAtPeriodEnd ? 'Access ends on' : live ? 'Next payment' : 'Ended'}</span>
                <b>{t.cancelAtPeriodEnd ? d(t.periodEnd) : live ? `${recurring ? planAmount(recurring) : ''} on ${d(t.periodEnd)}` : d(t.endedAt)}</b></div>
              <div><span>Total paid</span><b>{money(t.totalPaid, t.currency)}</b><span style={{ margin: '2px 0 0' }}>{t.payments} payment{t.payments === 1 ? '' : 's'}</span></div>
              {t.paymentMethod && <div><span>Payment method</span><b>{t.paymentMethod}</b></div>}
            </div>
            {pct != null && live && (
              <div className="cycle">
                <div className="meter"><i className={daysLeft != null && daysLeft <= 3 ? 'full' : ''} style={{ width: `${pct}%` }} /></div>
                <div className="cycle-row"><span>{d(t.periodStart)}</span><span>{daysLeft} day{daysLeft === 1 ? '' : 's'} left in this period</span><span>{d(t.periodEnd)}</span></div>
              </div>
            )}
            {t.cancelAtPeriodEnd && <p className="note warn" style={{ marginTop: 14 }}>The subscription is cancelled. You keep full access until {d(t.periodEnd)}; after that the HR portal and the app lock until you subscribe again.</p>}

            {!isOwner && <p className="muted small" style={{ marginTop: 12 }}>Only the owner can change the subscription.</p>}
            {isOwner && stripeReady && (
              <div className="row" style={{ marginTop: 16, marginBottom: 0 }}>
                <button className="btn" onClick={portal} disabled={!!busy}>{busy === 'portal' ? 'Opening…' : 'Payment method & invoices'}</button>
                {live && (t.cancelAtPeriodEnd
                  ? <button className="btn primary" onClick={() => cancel(true)} disabled={!!busy}>{busy === 'resume' ? 'Resuming…' : 'Resume subscription'}</button>
                  : <button className="btn" onClick={() => cancel(false)} disabled={!!busy}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel subscription'}</button>)}
                <span className="muted small">Card changes and receipts open on Stripe’s secure page.</span>
              </div>
            )}
          </>}
        </div>
      )}

      {/* ---- features: all included, switch off what you don't use ---- */}
      <div className="card">
        <h3>Features</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Every feature is included in your plan. Switch off what your organization doesn’t use — it disappears from the HR portal, the employee panel and the app. Switch it back on any time; nothing is deleted.</p>
        <div className="feat-row">
          <div><b>{FEATURE_LABEL.employees}</b><div className="muted small">{FEATURE_DESCRIPTION.employees} Always on.</div></div>
          <span className="pill ok">On</span>
        </div>
        {OPTIONAL_FEATURES.map(f => {
          const blocked = revoked.includes(f);
          const on = !disabled.has(f);
          return (
            <div key={f} className="feat-row">
              <div><b>{FEATURE_LABEL[f]}</b><div className="muted small">{FEATURE_DESCRIPTION[f]}{blocked && ' Turned off by the platform — contact support.'}</div></div>
              {blocked ? <span className="pill gray">Off</span> : (
                <div className="seg" role="radiogroup" aria-label={FEATURE_LABEL[f]}>
                  <button type="button" className={on ? 'on g' : ''} onClick={() => toggle(f, true)}>On</button>
                  <button type="button" className={!on ? 'on r' : ''} onClick={() => toggle(f, false)}>Off</button>
                </div>
              )}
            </div>
          );
        })}
        <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className="btn primary" onClick={saveFeatures} disabled={!!busy || !featuresChanged}>{busy === 'features' ? 'Saving…' : 'Save features'}</button>
        </div>
      </div>

      {/* ---- payment history ---- */}
      {!exempt && (
        <div className="card">
          <h3>Payment history</h3>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Date</th><th>Invoice</th><th>For the period</th><th>Amount</th><th>Status</th><th /></tr></thead>
              <tbody>
                {invoices.map(i => (
                  <tr key={i.id}>
                    <td>{d(i.paid_at ?? i.created_at)}</td>
                    <td>{i.number ?? '—'}<div className="muted small">{REASON[i.billing_reason ?? ''] ?? (i.billing_reason ?? '').replace(/_/g, ' ')}</div></td>
                    <td>{i.period_start && i.period_end ? `${d(i.period_start)} – ${d(i.period_end)}` : '—'}</td>
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
      )}
    </>
  );
}
