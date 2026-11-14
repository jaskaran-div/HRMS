import Link from 'next/link';
import { dashboard } from '@/lib/platform';
import { STATUS_LABEL, type OrgStatus } from '@/lib/org';
import { Icon } from '@/components/Icon';
import { fmtDate, monthLabel } from '@/lib/dates';
import { initials } from '@/lib/format';
import { money } from '@/lib/money';
import { platformName } from '@/lib/platform-mail';

export const dynamic = 'force-dynamic';

const d = (iso: string | null | undefined) => (iso ? fmtDate(iso.slice(0, 10)) : '—');
const tone = (s: OrgStatus) => (s === 'active' ? 'ok' : s === 'past_due' || s === 'pending_payment' ? 'warn' : 'bad');
const STATUS_ORDER: OrgStatus[] = ['active', 'past_due', 'pending_payment', 'unpaid', 'paused', 'canceled', 'expired', 'suspended'];

/** Platform admin home: the whole SaaS at a glance, in the same style as the HR dashboard. */
export default async function AdminDashboard() {
  const x = await dashboard();
  const st = new Map(x.byStatus);
  const revenue = x.revenue30.length ? x.revenue30.map(([c, a]) => money(a, c)).join(' + ') : '—';
  const maxStatus = Math.max(1, ...STATUS_ORDER.map(s => st.get(s) ?? 0));
  const maxSignup = Math.max(1, ...x.signups.map(s => s[1]));
  const maxEmp = Math.max(1, ...x.largest.map(o => o.employees));
  const paying = (st.get('active') ?? 0) - x.exempt;

  return (
    <>
      <div className="page-h">
        <div className="pagehead" style={{ margin: 0 }}>
          <h1>Platform overview</h1>
          <p>Every organization on {platformName()}: status, people, payments.</p>
        </div>
        <span className="sp" />
        <Link href="/admin/payments" className="btn"><Icon name="wallet" size={16} /> Payments</Link>
        <Link href="/admin/organizations/new" className="btn primary"><Icon name="plus" size={16} /> New organization</Link>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-h"><h3><span className="dot" /> Platform</h3><span className="sp" />
            <Link href="/admin/organizations" className="icon-btn" aria-label="All organizations" title="All organizations"><Icon name="building" size={16} /></Link></div>
          <div className="profile-card">
            <div className="big-av">{initials(platformName())}<span className="tag">{x.orgCount} orgs</span></div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h2>{platformName()}</h2>
              <div className="facts">
                <div><small>Paying (Stripe)</small><span>{Math.max(0, paying)}</span></div>
                <div><small>Free / managed</small><span>{x.exempt}</span></div>
                <div><small>New, last 30 days</small><span>{x.newThisMonth}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="tiles">
          <Link href="/admin/organizations" className="tile" style={{ color: 'inherit' }}><small>Organizations</small><b>{x.orgCount}</b><div className="sub">{st.get('active') ?? 0} active</div></Link>
          <Link href="/admin/organizations?status=pending_payment" className="tile" style={{ color: 'inherit' }}><small>Awaiting payment</small><b>{st.get('pending_payment') ?? 0}</b><div className="sub">{st.get('past_due') ?? 0} overdue</div></Link>
          <div className="tile"><small>Employees · all orgs</small><b>{x.employees}</b><div className="sub">{x.users} active logins</div></div>
          <Link href="/admin/payments?status=paid&days=30" className="tile" style={{ color: 'inherit' }}><small>Revenue · 30 days</small><b style={{ fontSize: revenue.length > 12 ? 20 : undefined }}>{revenue}</b><div className="sub">{x.failed.length ? `${x.failed.length} failed payment(s) →` : 'No failed payments'}</div></Link>
        </div>
      </div>

      <div className="two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><h3>Organizations by status</h3><span className="sp" /><Link href="/admin/organizations" className="btn sm">See all</Link></div>
          {STATUS_ORDER.map(s => (
            <Link key={s} href={`/admin/organizations?status=${s}`} className="bar-row" style={{ color: 'inherit' }}>
              <span>{STATUS_LABEL[s]}</span><div className="bar"><i style={{ width: `${((st.get(s) ?? 0) / maxStatus) * 100}%` }} /></div><b>{st.get(s) ?? 0}</b>
            </Link>
          ))}
        </div>
        <div className="card">
          <h3>New organizations · last 6 months</h3>
          {x.signups.map(([m, n]) => (
            <div className="bar-row" key={m}><span>{monthLabel(`${m}-01`)}</span><div className="bar"><i style={{ width: `${(n / maxSignup) * 100}%` }} /></div><b>{n}</b></div>
          ))}
        </div>
      </div>

      <div className="two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><h3>Newest organizations</h3><span className="sp" /><Link href="/admin/organizations" className="btn sm">See all</Link></div>
          {x.recentOrgs.map(o => (
            <Link key={o.id} href={`/admin/organizations/${o.id}`} className="who-c" style={{ padding: '9px 0', borderBottom: '1px solid var(--line-2)', color: 'inherit' }}>
              <span className="av">{initials(o.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}><b>{o.name}</b><div className="muted small">{o.owner_email ?? o.slug} · {d(o.created_at)}</div></div>
              <span className={`pill ${tone(o.status)}`}>{STATUS_LABEL[o.status]}</span>
            </Link>
          ))}
          {!x.recentOrgs.length && <p className="muted" style={{ margin: 0 }}>No organizations yet. <Link href="/admin/organizations/new">Create one</Link>.</p>}
        </div>
        <div className="card">
          <h3>Largest organizations · employees</h3>
          {x.largest.map(o => (
            <Link key={o.id} href={`/admin/organizations/${o.id}`} className="bar-row" style={{ color: 'inherit' }}>
              <span>{o.name}</span><div className="bar"><i style={{ width: `${(o.employees / maxEmp) * 100}%` }} /></div><b>{o.employees}</b>
            </Link>
          ))}
          {!x.largest.length && <p className="muted">No organizations yet.</p>}
        </div>
      </div>

      <div className="two">
        <div className="card">
          <div className="card-h"><h3>Failed payments</h3><span className="sp" /><Link href="/admin/payments?status=failed" className="btn sm">See all</Link></div>
          {x.failed.map(f => (
            <Link key={f.id} href={`/admin/organizations/${f.org_id}`} className="who-c" style={{ padding: '9px 0', borderBottom: '1px solid var(--line-2)', color: 'inherit' }}>
              <span className="av">{initials(f.org_name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}><b>{f.org_name}</b><div className="err small">{f.last_error ?? 'Payment failed'}</div></div>
              <div style={{ textAlign: 'right' }}><b>{money(f.amount_due, f.currency)}</b><div className="muted small">{f.attempt_count} attempt(s)</div></div>
            </Link>
          ))}
          {!x.failed.length && <p className="muted" style={{ margin: 0 }}>No failed payments. 🎉</p>}
          {x.renewingSoon.length > 0 && <>
            <h3 style={{ marginTop: 18 }}>Renewing in the next 7 days</h3>
            <div className="chips">{x.renewingSoon.map(o => <Link key={o.id} href={`/admin/organizations/${o.id}`} className="pill blue">{o.name} · {o.cancel_at_period_end ? 'ends' : 'renews'} {d(o.current_period_end)}</Link>)}</div>
          </>}
        </div>
        <div className="card">
          <div className="card-h"><h3>Latest payments</h3><span className="sp" /><Link href="/admin/payments" className="btn sm">See all</Link></div>
          {x.recentPaid.map(p => (
            <Link key={p.id} href={`/admin/organizations/${p.org_id}`} className="who-c" style={{ padding: '9px 0', borderBottom: '1px solid var(--line-2)', color: 'inherit' }}>
              <span className="av">{initials(p.org_name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}><b>{p.org_name}</b><div className="muted small">{p.number} · {d(p.paid_at)}</div></div>
              <b>{money(p.amount_paid, p.currency)}</b>
            </Link>
          ))}
          {!x.recentPaid.length && <p className="muted" style={{ margin: 0 }}>No payments yet — they appear here once Stripe is connected and organizations subscribe.</p>}
        </div>
      </div>
    </>
  );
}
