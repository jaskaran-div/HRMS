import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orgDetail } from '@/lib/platform';
import { orgFeatures, STATUS_LABEL } from '@/lib/org';
import { FEATURE_LABEL, isFeature } from '@/lib/billing/catalog';
import { fmtDate } from '@/lib/dates';
import { money } from '@/lib/money';
import { OrgActions } from './OrgActions';

export const dynamic = 'force-dynamic';

const d = (iso: string | null | undefined) => (iso ? fmtDate(iso.slice(0, 10)) : '—');

export default async function AdminOrg({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const x = await orgDetail(id);
  if (!x) notFound();
  const { org, invoices, events, owner, members, audit } = x;
  const failed = invoices.filter(i => i.status !== 'paid' && (i.attempt_count ?? 0) > 0);
  return (
    <>
      <p><Link href="/admin">← All organizations</Link></p>
      <div className="card">
        <h3>{org.name}</h3>
        <dl className="kv">
          <dt>Status</dt><dd>{STATUS_LABEL[org.status]}{org.billing_exempt ? ' · billing exempt' : ''}{org.suspended_reason ? ` · ${org.suspended_reason}` : ''}</dd>
          <dt>Owner</dt><dd>{owner ? `${owner.full_name} (${owner.email ?? owner.username})` : org.owner_email ?? '—'}</dd>
          <dt>Email verified</dt><dd>{d(org.email_verified_at)}</dd>
          <dt>Onboarded</dt><dd>{d(org.onboarded_at)}</dd>
          <dt>Active members</dt><dd>{members}</dd>
          <dt>Stripe mode</dt><dd>{org.stripe_livemode == null ? '—' : org.stripe_livemode ? 'live' : 'test'}</dd>
          <dt>Stripe customer</dt><dd><code>{org.stripe_customer_id ?? '—'}</code></dd>
          <dt>Subscription</dt><dd><code>{org.stripe_subscription_id ?? '—'}</code> {org.stripe_subscription_status}</dd>
          <dt>Base plan</dt><dd><code>{org.stripe_base_price_id ?? '—'}</code></dd>
          <dt>Purchased add-ons</dt><dd>{(org.addons ?? []).filter(isFeature).map(f => FEATURE_LABEL[f]).join(', ') || '—'}</dd>
          <dt>Effective features</dt><dd>{orgFeatures(org).map(f => FEATURE_LABEL[f]).join(', ') || '—'}</dd>
          <dt>Billing period</dt><dd>{d(org.current_period_start)} – {d(org.current_period_end)}</dd>
          <dt>Next renewal</dt><dd>{org.cancel_at_period_end ? 'none (cancels at period end)' : d(org.current_period_end)}</dd>
          <dt>Cancellation</dt><dd>{org.cancel_at_period_end ? `scheduled for ${d(org.cancel_at ?? org.current_period_end)}` : org.canceled_at ? `cancelled ${d(org.canceled_at)}, ended ${d(org.ended_at)}` : 'not cancelled'}</dd>
          <dt>Last payment failure</dt><dd>{org.last_payment_failed_at ? `${d(org.last_payment_failed_at)} — ${org.last_payment_error ?? ''}` : '—'}</dd>
          <dt>Last Stripe sync</dt><dd>{org.stripe_synced_at ? new Date(org.stripe_synced_at).toLocaleString() : '—'}</dd>
        </dl>
      </div>

      <OrgActions id={org.id} status={org.status} exempt={org.billing_exempt} overrides={{ grant: org.entitlement_overrides?.grant ?? [], revoke: org.entitlement_overrides?.revoke ?? [] }} />

      <div className="card">
        <h3>Payment history {failed.length > 0 && <span className="pill bad">{failed.length} failed</span>}</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Created</th><th>Invoice</th><th>Reason</th><th>Amount</th><th>Status</th><th>Attempts</th><th>Error</th><th /></tr></thead>
            <tbody>
              {invoices.map(i => (
                <tr key={i.id}>
                  <td>{d(i.created_at)}</td><td><code className="small">{i.number ?? i.id}</code></td><td className="small">{i.billing_reason}</td>
                  <td>{money(i.status === 'paid' ? i.amount_paid : i.amount_due, i.currency)}</td><td>{i.status}</td><td>{i.attempt_count}</td>
                  <td className="small err">{i.status !== 'paid' ? i.last_error : ''}</td>
                  <td>{i.hosted_invoice_url && <a className="btn sm" href={i.hosted_invoice_url} target="_blank" rel="noreferrer">Open</a>}</td>
                </tr>
              ))}
              {!invoices.length && <tr><td colSpan={8} className="muted">No invoices.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Billing log</h3>
        <div className="tbl-wrap"><table><tbody>
          {audit.map((a, k) => <tr key={k}><td style={{ whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString()}</td><td>{a.actor_name}</td><td><code>{a.action}</code></td><td className="small muted">{JSON.stringify(a.details)}</td></tr>)}
          {!audit.length && <tr><td className="muted">Nothing yet.</td></tr>}
        </tbody></table></div>
      </div>

      <div className="card">
        <h3>Stripe webhook events</h3>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Received</th><th>Type</th><th>Status</th><th>Attempts</th><th>Error</th></tr></thead>
          <tbody>
            {events.map(e => <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{new Date(e.received_at).toLocaleString()}</td><td><code className="small">{e.type}</code></td><td>{e.status}</td><td>{e.attempts}</td><td className="small err">{e.error}</td></tr>)}
            {!events.length && <tr><td colSpan={5} className="muted">No events.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
