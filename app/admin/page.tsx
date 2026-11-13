import Link from 'next/link';
import { listOrgs } from '@/lib/platform';
import { STATUS_LABEL } from '@/lib/org';
import { FEATURE_LABEL, isFeature } from '@/lib/billing/catalog';
import { fmtDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const d = (iso: string | null) => (iso ? fmtDate(iso.slice(0, 10)) : '—');

export default async function AdminHome() {
  const orgs = await listOrgs();
  return (
    <div className="card">
      <h3>Organizations ({orgs.length})</h3>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Organization</th><th>Status</th><th>Stripe customer</th><th>Subscription</th><th>Base plan</th><th>Add-ons</th><th>Period ends</th><th>Failed</th><th>Members</th></tr></thead>
          <tbody>
            {orgs.map(o => (
              <tr key={o.id}>
                <td><Link href={`/admin/orgs/${o.id}`}><b>{o.name}</b></Link><div className="muted small">{o.slug} · {d(o.created_at)}</div></td>
                <td><span className={`pill ${o.status === 'active' ? 'ok' : o.status === 'past_due' || o.status === 'pending_payment' ? 'warn' : 'bad'}`}>{STATUS_LABEL[o.status]}</span>
                  {o.billing_exempt && <div className="muted small">exempt</div>}
                  {o.cancel_at_period_end && <div className="muted small">cancels at period end</div>}</td>
                <td className="small"><code>{o.stripe_customer_id ?? '—'}</code></td>
                <td className="small"><code>{o.stripe_subscription_id ?? '—'}</code><div className="muted">{o.stripe_subscription_status ?? ''}</div></td>
                <td className="small"><code>{o.stripe_base_price_id ?? '—'}</code></td>
                <td className="small">{(o.addons ?? []).filter(isFeature).map(f => FEATURE_LABEL[f]).join(', ') || '—'}</td>
                <td>{d(o.current_period_end)}</td>
                <td>{o.failed_invoices || o.last_payment_failed_at ? <span className="pill bad">{o.failed_invoices || '!'}</span> : '—'}</td>
                <td>{o.members}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
