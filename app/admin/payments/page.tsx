import Link from 'next/link';
import { listOrgs, listPayments, totals } from '@/lib/platform';
import { fmtDate } from '@/lib/dates';
import { money } from '@/lib/money';

export const dynamic = 'force-dynamic';

const d = (iso: string | null | undefined) => (iso ? fmtDate(iso.slice(0, 10)) : '—');
const STATUSES: [string, string][] = [['', 'All'], ['paid', 'Paid'], ['failed', 'Failed (retrying)'], ['open', 'Open / unpaid'], ['void', 'Void'], ['uncollectible', 'Uncollectible'], ['draft', 'Draft']];

/** Every organization's Stripe invoices in one place. */
export default async function AdminPayments({ searchParams }: { searchParams: Promise<{ status?: string; org?: string; days?: string }> }) {
  const sp = await searchParams;
  const days = Number(sp.days) || undefined;
  const [rows, orgs] = await Promise.all([listPayments({ status: sp.status, org: sp.org, days }), listOrgs()]);
  const paid = totals(rows.filter(r => r.status === 'paid').map(r => ({ currency: r.currency, amount: r.amount_paid })));
  const due = totals(rows.filter(r => r.status === 'open').map(r => ({ currency: r.currency, amount: r.amount_due })));
  return (
    <>
      <div className="kpis">
        <div className="kpi"><div><small>Paid (shown)</small><b>{paid.length ? paid.map(([c, a]) => money(a, c)).join(' + ') : '—'}</b><small>{rows.filter(r => r.status === 'paid').length} invoice(s)</small></div></div>
        <div className="kpi"><div><small>Outstanding (shown)</small><b>{due.length ? due.map(([c, a]) => money(a, c)).join(' + ') : '—'}</b><small>{rows.filter(r => r.status === 'open').length} open invoice(s)</small></div></div>
        <div className="kpi"><div><small>Failed payments</small><b>{rows.filter(r => r.status === 'open' && (r.attempt_count ?? 0) > 0).length}</b><small>Stripe is retrying</small></div></div>
      </div>
      <div className="card">
        <form className="row" method="get">
          <select name="status" defaultValue={sp.status ?? ''}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select name="org" defaultValue={sp.org ?? ''}>
            <option value="">All organizations</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select name="days" defaultValue={sp.days ?? ''}>
            <option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option>
          </select>
          <button className="btn">Filter</button>
          <span className="sp" style={{ flex: 1 }} />
          <span className="muted small">{rows.length} invoice(s){rows.length === 500 && ' (latest 500)'}</span>
        </form>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Date</th><th>Organization</th><th>Invoice</th><th>Period</th><th>Amount</th><th>Status</th><th>Attempts</th><th /></tr></thead>
            <tbody>
              {rows.map(i => (
                <tr key={i.id}>
                  <td>{d(i.paid_at ?? i.created_at)}</td>
                  <td><Link href={`/admin/organizations/${i.org_id}`}>{i.org_name}</Link>{!i.livemode && <div className="muted small">test</div>}</td>
                  <td><code className="small">{i.number ?? i.id}</code><div className="muted small">{(i.billing_reason ?? '').replace(/_/g, ' ')}</div></td>
                  <td className="small">{i.period_start ? `${d(i.period_start)} – ${d(i.period_end)}` : '—'}</td>
                  <td>{money(i.status === 'paid' ? i.amount_paid : i.amount_due, i.currency)}</td>
                  <td><span className={`pill ${i.status === 'paid' ? 'ok' : i.status === 'open' ? 'warn' : 'gray'}`}>{i.status}</span>{i.last_error && i.status !== 'paid' && <div className="err small">{i.last_error}</div>}</td>
                  <td>{i.attempt_count ?? 0}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{i.hosted_invoice_url && <a className="btn sm" href={i.hosted_invoice_url} target="_blank" rel="noreferrer">Open</a>} {i.invoice_pdf && <a className="btn sm" href={i.invoice_pdf} target="_blank" rel="noreferrer">PDF</a>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="muted">No payments match. Payments appear here once Stripe is connected and organizations subscribe.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
