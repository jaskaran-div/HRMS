import Link from 'next/link';
import { listOrgs } from '@/lib/platform';
import { STATUS_LABEL, type OrgStatus } from '@/lib/org';
import { FEATURE_LABEL, isFeature } from '@/lib/billing/catalog';
import { fmtDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const d = (iso: string | null | undefined) => (iso ? fmtDate(iso.slice(0, 10)) : '—');
const used = (n: number, max: number | null) => (max == null ? `${n}` : `${n} / ${max}`);

export default async function AdminOrganizations({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const orgs = await listOrgs(sp);
  return (
    <div className="card">
      <form className="row" method="get">
        <input className="field" name="q" defaultValue={sp.q ?? ''} placeholder="Search name, short name, owner email, Stripe id…" style={{ minWidth: 280 }} />
        <select name="status" defaultValue={sp.status ?? ''}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as OrgStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          <option value="exempt">Free / managed plan</option>
        </select>
        <button className="btn">Filter</button>
        <span className="sp" style={{ flex: 1 }} />
        <span className="muted small">{orgs.length} organization(s)</span>
      </form>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Organization</th><th>Owner</th><th>Status</th><th>Plan</th><th>Employees</th><th>Logins</th><th>Renews / ends</th><th>Payments</th><th>Created</th></tr></thead>
          <tbody>
            {orgs.map(o => (
              <tr key={o.id}>
                <td><Link href={`/admin/organizations/${o.id}`}><b>{o.name}</b></Link><div className="muted small">{o.slug}</div></td>
                <td className="small">{o.owner_email ?? '—'}</td>
                <td><span className={`pill ${o.status === 'active' ? 'ok' : o.status === 'past_due' || o.status === 'pending_payment' ? 'warn' : 'bad'}`}>{STATUS_LABEL[o.status]}</span>
                  {o.cancel_at_period_end && <div className="muted small">cancels at period end</div>}</td>
                <td className="small">{o.billing_exempt ? 'Free / managed' : o.stripe_subscription_id ? 'Stripe' : '—'}
                  {(o.addons ?? []).filter(isFeature).length > 0 && <div className="muted">+ {(o.addons ?? []).filter(isFeature).map(f => FEATURE_LABEL[f]).join(', ')}</div>}</td>
                <td>{used(o.employees, o.max_employees)}</td>
                <td>{used(o.users, o.max_users)}</td>
                <td className="small">{d(o.current_period_end)}</td>
                <td>{o.failed ? <span className="pill bad">{o.failed} failed</span> : <span className="muted">—</span>}</td>
                <td className="small muted">{d(o.created_at)}</td>
              </tr>
            ))}
            {!orgs.length && <tr><td colSpan={9} className="muted">No organizations match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
