import Link from 'next/link';
import { dashboard } from '@/lib/platform';
import { STATUS_LABEL, type OrgStatus } from '@/lib/org';
import { fmtDate } from '@/lib/dates';
import { money } from '@/lib/money';

export const dynamic = 'force-dynamic';

const d = (iso: string | null | undefined) => (iso ? fmtDate(iso.slice(0, 10)) : '—');
const tone = (s: OrgStatus) => (s === 'active' ? 'ok' : s === 'past_due' || s === 'pending_payment' ? 'warn' : 'bad');

export default async function AdminDashboard() {
  const x = await dashboard();
  const st = new Map(x.byStatus);
  return (
    <>
      <div className="kpis">
        <div className="kpi"><div><small>Organizations</small><b>{x.orgCount}</b><small>{x.newThisMonth} new in the last 30 days</small></div></div>
        <div className="kpi"><div><small>Active</small><b>{st.get('active') ?? 0}</b><small>{x.exempt} on a free / managed plan</small></div></div>
        <div className="kpi"><div><small>Awaiting payment</small><b>{st.get('pending_payment') ?? 0}</b><small>{st.get('past_due') ?? 0} overdue</small></div></div>
        <div className="kpi"><div><small>Employees (all orgs)</small><b>{x.employees}</b><small>{x.users} active logins</small></div></div>
        <div className="kpi"><div><small>Revenue, last 30 days</small><b>{x.revenue30.length ? x.revenue30.map(([c, a]) => money(a, c)).join(' + ') : '—'}</b><small>paid invoices</small></div></div>
        <div className="kpi"><div><small>Failed payments</small><b>{x.failed.length}</b><small>open invoices with a failed attempt</small></div></div>
      </div>

      <div className="admin-grid">
        <div className="card">
          <div className="card-h"><h3>Newest organizations</h3><span className="sp" /><Link href="/admin/organizations">All</Link></div>
          <div className="tbl-wrap"><table><tbody>
            {x.recentOrgs.map(o => (
              <tr key={o.id}>
                <td><Link href={`/admin/organizations/${o.id}`}><b>{o.name}</b></Link><div className="muted small">{o.owner_email ?? o.slug}</div></td>
                <td><span className={`pill ${tone(o.status)}`}>{STATUS_LABEL[o.status]}</span>{o.billing_exempt && <div className="muted small">free / managed</div>}</td>
                <td className="small muted">{d(o.created_at)}</td>
              </tr>
            ))}
            {!x.recentOrgs.length && <tr><td className="muted">No organizations yet.</td></tr>}
          </tbody></table></div>
        </div>

        <div className="card">
          <div className="card-h"><h3>Organizations by status</h3></div>
          <div className="tbl-wrap"><table><tbody>
            {(Object.keys(STATUS_LABEL) as OrgStatus[]).map(s => (
              <tr key={s}><td><Link href={`/admin/organizations?status=${s}`}>{STATUS_LABEL[s]}</Link></td><td style={{ textAlign: 'right' }}><b>{st.get(s) ?? 0}</b></td></tr>
            ))}
          </tbody></table></div>
        </div>

        <div className="card">
          <div className="card-h"><h3>Failed payments</h3><span className="sp" /><Link href="/admin/payments?status=failed">All</Link></div>
          <div className="tbl-wrap"><table><tbody>
            {x.failed.map(f => (
              <tr key={f.id}>
                <td><Link href={`/admin/organizations/${f.org_id}`}>{f.org_name}</Link><div className="err small">{f.last_error ?? 'Payment failed'}</div></td>
                <td>{money(f.amount_due, f.currency)}<div className="muted small">{f.attempt_count} attempt(s)</div></td>
              </tr>
            ))}
            {!x.failed.length && <tr><td className="muted">No failed payments.</td></tr>}
          </tbody></table></div>
        </div>

        <div className="card">
          <div className="card-h"><h3>Latest payments</h3><span className="sp" /><Link href="/admin/payments">All</Link></div>
          <div className="tbl-wrap"><table><tbody>
            {x.recentPaid.map(p => (
              <tr key={p.id}><td><Link href={`/admin/organizations/${p.org_id}`}>{p.org_name}</Link><div className="muted small">{p.number}</div></td><td>{money(p.amount_paid, p.currency)}</td><td className="small muted">{d(p.paid_at)}</td></tr>
            ))}
            {!x.recentPaid.length && <tr><td className="muted">No payments yet.</td></tr>}
          </tbody></table></div>
        </div>

        <div className="card">
          <div className="card-h"><h3>Renewing in the next 7 days</h3></div>
          <div className="tbl-wrap"><table><tbody>
            {x.renewingSoon.map(o => (
              <tr key={o.id}><td><Link href={`/admin/organizations/${o.id}`}>{o.name}</Link></td><td className="small">{o.cancel_at_period_end ? 'ends' : 'renews'} {d(o.current_period_end)}</td></tr>
            ))}
            {!x.renewingSoon.length && <tr><td className="muted">Nothing this week.</td></tr>}
          </tbody></table></div>
        </div>
      </div>
    </>
  );
}
