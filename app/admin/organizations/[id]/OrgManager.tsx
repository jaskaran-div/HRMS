'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminCall } from '../../AdminNav';
import { PlanFields, planFrom, type Plan } from '../../PlanFields';
import { STATUS_LABEL } from '@/lib/org';
import { FEATURE_LABEL, isFeature, type Feature } from '@/lib/billing/catalog';
import { ROLE_LABEL } from '@/lib/roles';
import { fmtDate } from '@/lib/dates';
import { money } from '@/lib/money';
import type { Member, OrgRow } from '@/lib/platform';
import type { Role } from '@/lib/types';

type Inv = { id: string; number: string | null; status: string | null; billing_reason: string | null; currency: string | null; amount_due: number | null; amount_paid: number | null; attempt_count: number | null; last_error: string | null; hosted_invoice_url: string | null; invoice_pdf: string | null; period_start: string | null; period_end: string | null; paid_at: string | null; created_at: string };
type Ev = { id: string; type: string; status: string; attempts: number; error: string | null; received_at: string };
interface Data {
  org: OrgRow; members: Member[]; invoices: Inv[]; events: Ev[]; employees: number; archived: number; features: Feature[];
  settings: { company_name: string; company_address: string; hr_email: string | null; email_domains: string | null } | null;
}
type Tab = 'overview' | 'plan' | 'members' | 'payments' | 'danger';

const d = (iso: string | null | undefined) => (iso ? fmtDate(iso.slice(0, 10)) : '—');
const ROLES: Role[] = ['admin', 'hr_admin', 'editor', 'viewer', 'team_lead', 'employee'];

export function OrgManager({ data }: { data: Data }) {
  const { org } = data;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(what: string, body: object, method: 'PATCH' | 'DELETE' = 'PATCH', done = 'Saved.') {
    setBusy(what); setMsg(null);
    try {
      await adminCall(`/api/admin/orgs/${org.id}`, method, body);
      setMsg({ ok: true, text: done });
      if (method === 'DELETE') { router.push('/admin/organizations'); return; }
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy('');
  }

  const tone = org.status === 'active' ? 'ok' : org.status === 'past_due' || org.status === 'pending_payment' ? 'warn' : 'bad';
  return (
    <>
      <p style={{ margin: '0 0 10px' }}><Link href="/admin/organizations">← Organizations</Link></p>
      <div className="row">
        <h2 style={{ margin: 0 }}>{org.name}</h2>
        <span className={`pill ${tone}`}>{STATUS_LABEL[org.status]}</span>
        {org.billing_exempt && <span className="pill gray">Free / managed</span>}
        <span className="muted small">{org.slug}</span>
      </div>
      <div className="tabs" style={{ marginTop: 6, marginBottom: 14 }}>
        {([['overview', 'Overview'], ['plan', 'Plan & features'], ['members', `Members (${data.members.length})`], ['payments', `Payments (${data.invoices.length})`], ['danger', 'Suspend / delete']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>
        ))}
      </div>
      {msg && <div className={`note ${msg.ok ? 'ok' : 'bad'}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      {tab === 'overview' && <Overview data={data} busy={busy} act={act} />}
      {tab === 'plan' && <PlanTab data={data} busy={busy} act={act} />}
      {tab === 'members' && <Members data={data} busy={busy} act={act} />}
      {tab === 'payments' && <Payments data={data} busy={busy} act={act} />}
      {tab === 'danger' && <Danger data={data} busy={busy} act={act} />}
    </>
  );
}

type TabProps = { data: Data; busy: string; act: (what: string, body: object, method?: 'PATCH' | 'DELETE', done?: string) => Promise<void> };

function Overview({ data, busy, act }: TabProps) {
  const { org } = data;
  const [f, setF] = useState({
    name: org.name, phone: org.phone ?? '', country: org.country ?? '', owner_email: org.owner_email ?? '', admin_notes: org.admin_notes ?? '',
    company_name: data.settings?.company_name ?? org.name, company_address: data.settings?.company_address ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const owner = data.members.find(m => m.role === 'owner');
  return (
    <div className="admin-grid">
      <form className="card" onSubmit={e => { e.preventDefault(); act('details', { action: 'details', ...f }); }}>
        <h3>Organization details</h3>
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <label>Name<input value={f.name} onChange={set('name')} required /></label>
          <label>Company name on payslips<input value={f.company_name} onChange={set('company_name')} /></label>
          <label className="wide">Company address<input value={f.company_address} onChange={set('company_address')} /></label>
          <label>Owner contact email<input type="email" value={f.owner_email} onChange={set('owner_email')} /></label>
          <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
          <label>Country<input value={f.country} onChange={set('country')} /></label>
          <label className="wide">Internal notes (only visible here)<textarea rows={3} value={f.admin_notes} onChange={set('admin_notes')} /></label>
        </div>
        <div className="row" style={{ marginTop: 14, marginBottom: 0 }}><button className="btn primary" disabled={!!busy}>{busy === 'details' ? 'Saving…' : 'Save details'}</button></div>
      </form>

      <div className="card">
        <h3>At a glance</h3>
        <dl className="kv">
          <dt>Owner</dt><dd>{owner ? `${owner.full_name} (${owner.email ?? owner.username})` : '—'}</dd>
          <dt>Created</dt><dd>{d(org.created_at)}</dd>
          <dt>Email verified</dt><dd>{org.email_verified_at ? d(org.email_verified_at) : <>no · <button className="btn sm" disabled={!!busy} onClick={() => act('verify', { action: 'verify_email' }, 'PATCH', 'Email marked verified.')}>Mark verified</button></>}</dd>
          <dt>Set up (onboarded)</dt><dd>{d(org.onboarded_at)}</dd>
          <dt>Employees</dt><dd>{data.employees}{org.max_employees != null && ` of ${org.max_employees}`} active · {data.archived} archived</dd>
          <dt>Logins</dt><dd>{data.members.filter(m => m.status === 'active').length}{org.max_users != null && ` of ${org.max_users}`} active</dd>
          <dt>Features</dt><dd>{data.features.map(x => FEATURE_LABEL[x]).join(', ') || 'none (no access)'}</dd>
          <dt>Billing</dt><dd>{org.billing_exempt ? 'Free / managed' : org.stripe_subscription_id ? `Stripe · ${org.stripe_subscription_status}` : 'Not subscribed yet'}</dd>
          <dt>{org.cancel_at_period_end ? 'Ends on' : 'Renews on'}</dt><dd>{d(org.current_period_end)}</dd>
          {org.suspended_reason && <><dt>Suspended</dt><dd className="err">{org.suspended_reason}</dd></>}
        </dl>
      </div>
    </div>
  );
}

function PlanTab({ data, busy, act }: TabProps) {
  const { org } = data;
  const [plan, setPlan] = useState<Plan>(planFrom(org));
  return (
    <form className="card" onSubmit={e => { e.preventDefault(); act('plan', { action: 'plan', ...plan }); }}>
      <h3>Plan, features and limits</h3>
      <PlanFields plan={plan} onChange={setPlan} bought={(org.addons ?? []).filter(isFeature)}
        usage={{ employees: data.employees, users: data.members.filter(m => m.status === 'active').length }} />
      <p className="muted small">Lowering a limit below what is in use keeps existing records; it only blocks adding more.</p>
      <div className="row" style={{ marginBottom: 0 }}><button className="btn primary" disabled={!!busy}>{busy === 'plan' ? 'Saving…' : 'Save plan'}</button></div>
    </form>
  );
}

function Members({ data, busy, act }: TabProps) {
  return (
    <div className="card">
      <h3>Members</h3>
      <p className="muted small" style={{ marginTop: 0 }}>The organization invites and manages its own people under User Access. Here you can fix roles, disable a login or hand over ownership.</p>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Name</th><th>Login</th><th>Role</th><th>Status</th><th>Since</th><th /></tr></thead>
          <tbody>
            {data.members.map(m => (
              <tr key={m.user_id}>
                <td><b>{m.full_name}</b>{!m.employee_id && m.role !== 'owner' && <div className="muted small">not linked to an employee</div>}</td>
                <td className="small">{m.email ?? m.username}<div className="muted">{m.username}</div></td>
                <td>{m.role === 'owner' ? <span className="pill ok">Owner</span> : (
                  <select value={m.role} disabled={!!busy} onChange={e => act(`role-${m.user_id}`, { action: 'member_role', user_id: m.user_id, role: e.target.value }, 'PATCH', 'Role changed.')}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>)}</td>
                <td>{m.status === 'active' ? <span className="pill ok">Active</span> : <span className="pill bad">Disabled</span>}</td>
                <td className="small muted">{d(m.created_at)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {m.role !== 'owner' && m.status === 'active' && <button className="btn sm" disabled={!!busy} onClick={() => confirm(`Make ${m.full_name} the owner? The current owner becomes an admin.`) && act(`own-${m.user_id}`, { action: 'make_owner', user_id: m.user_id }, 'PATCH', 'Ownership transferred.')}>Make owner</button>}{' '}
                  {m.role !== 'owner' && (m.status === 'active'
                    ? <button className="btn sm danger" disabled={!!busy} onClick={() => act(`st-${m.user_id}`, { action: 'member_status', user_id: m.user_id, active: false }, 'PATCH', 'Login disabled.')}>Disable</button>
                    : <button className="btn sm" disabled={!!busy} onClick={() => act(`st-${m.user_id}`, { action: 'member_status', user_id: m.user_id, active: true }, 'PATCH', 'Login enabled.')}>Enable</button>)}
                </td>
              </tr>
            ))}
            {!data.members.length && <tr><td colSpan={6} className="muted">No members.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Payments({ data, busy, act }: TabProps) {
  const { org } = data;
  const paid = data.invoices.filter(i => i.status === 'paid');
  const failed = data.invoices.filter(i => i.status === 'open' && (i.attempt_count ?? 0) > 0);
  const sum = new Map<string, number>();
  for (const i of paid) if (i.currency) sum.set(i.currency, (sum.get(i.currency) ?? 0) + (i.amount_paid ?? 0));
  return (
    <>
      <div className="kpis">
        <div className="kpi"><div><small>Total paid</small><b>{sum.size ? [...sum].map(([c, a]) => money(a, c)).join(' + ') : '—'}</b><small>{paid.length} invoice(s)</small></div></div>
        <div className="kpi"><div><small>Failed / unpaid</small><b>{failed.length}</b><small>{org.last_payment_failed_at ? `last failure ${d(org.last_payment_failed_at)}` : 'no failures'}</small></div></div>
        <div className="kpi"><div><small>{org.cancel_at_period_end ? 'Ends on' : 'Next renewal'}</small><b style={{ fontSize: 18 }}>{d(org.current_period_end)}</b><small>period from {d(org.current_period_start)}</small></div></div>
      </div>
      <div className="card">
        <div className="card-h">
          <h3>Subscription</h3><span className="sp" />
          <button className="btn" disabled={!!busy || !org.stripe_customer_id} onClick={() => act('sync', { action: 'sync' }, 'PATCH', 'Synced from Stripe.')}>{busy === 'sync' ? 'Syncing…' : 'Sync from Stripe'}</button>
        </div>
        <dl className="kv">
          <dt>Stripe customer</dt><dd><code>{org.stripe_customer_id ?? '—'}</code> {org.stripe_livemode != null && <span className="muted small">({org.stripe_livemode ? 'live' : 'test'})</span>}</dd>
          <dt>Subscription</dt><dd><code>{org.stripe_subscription_id ?? '—'}</code> {org.stripe_subscription_status}</dd>
          <dt>Base plan price</dt><dd><code>{org.stripe_base_price_id ?? '—'}</code></dd>
          <dt>Purchased add-ons</dt><dd>{(org.addons ?? []).filter(isFeature).map(f => FEATURE_LABEL[f]).join(', ') || '—'}</dd>
          <dt>Cancellation</dt><dd>{org.cancel_at_period_end ? `scheduled for ${d(org.cancel_at ?? org.current_period_end)}` : org.canceled_at ? `cancelled ${d(org.canceled_at)}` : 'not cancelled'}</dd>
          <dt>Last payment error</dt><dd className={org.last_payment_error ? 'err' : ''}>{org.last_payment_error ?? '—'}</dd>
          <dt>Last synced</dt><dd>{org.stripe_synced_at ? new Date(org.stripe_synced_at).toLocaleString() : '—'}</dd>
        </dl>
        <p className="muted small" style={{ marginBottom: 0 }}>Refunds, card changes and manual invoices are done in the Stripe Dashboard; they appear here after the next webhook or sync.</p>
      </div>
      <div className="card">
        <h3>Invoices</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Date</th><th>Invoice</th><th>Period</th><th>Amount</th><th>Status</th><th>Attempts</th><th /></tr></thead>
            <tbody>
              {data.invoices.map(i => (
                <tr key={i.id}>
                  <td>{d(i.paid_at ?? i.created_at)}</td>
                  <td><code className="small">{i.number ?? i.id}</code><div className="muted small">{(i.billing_reason ?? '').replace(/_/g, ' ')}</div></td>
                  <td className="small">{i.period_start ? `${d(i.period_start)} – ${d(i.period_end)}` : '—'}</td>
                  <td>{money(i.status === 'paid' ? i.amount_paid : i.amount_due, i.currency)}</td>
                  <td><span className={`pill ${i.status === 'paid' ? 'ok' : i.status === 'open' ? 'warn' : 'gray'}`}>{i.status}</span>{i.last_error && i.status !== 'paid' && <div className="err small">{i.last_error}</div>}</td>
                  <td>{i.attempt_count ?? 0}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{i.hosted_invoice_url && <a className="btn sm" href={i.hosted_invoice_url} target="_blank" rel="noreferrer">Open</a>} {i.invoice_pdf && <a className="btn sm" href={i.invoice_pdf} target="_blank" rel="noreferrer">PDF</a>}</td>
                </tr>
              ))}
              {!data.invoices.length && <tr><td colSpan={7} className="muted">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>Stripe events</h3>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Received</th><th>Event</th><th>Result</th><th>Error</th></tr></thead>
          <tbody>
            {data.events.map(e => <tr key={e.id}><td className="small">{new Date(e.received_at).toLocaleString()}</td><td><code className="small">{e.type}</code></td><td>{e.status}{e.attempts > 1 && ` (${e.attempts} tries)`}</td><td className="err small">{e.error}</td></tr>)}
            {!data.events.length && <tr><td colSpan={4} className="muted">No events yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

function Danger({ data, busy, act }: TabProps) {
  const { org } = data;
  const [reason, setReason] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  return (
    <div className="admin-grid">
      <div className="card">
        <h3>{org.status === 'suspended' ? 'Suspended' : 'Suspend'}</h3>
        {org.status === 'suspended' ? <>
          <p>Reason: <b>{org.suspended_reason}</b></p>
          <button className="btn primary" disabled={!!busy} onClick={() => act('unsuspend', { action: 'unsuspend' }, 'PATCH', 'Organization unsuspended.')}>Unsuspend</button>
        </> : <>
          <p className="muted small" style={{ marginTop: 0 }}>Everyone in the organization is locked out (web and mobile) until you unsuspend it. Nothing is deleted; billing in Stripe is not changed.</p>
          <label className="small" style={{ display: 'block' }}>Reason (shown to the organization)<input className="field" style={{ width: '100%' }} value={reason} onChange={e => setReason(e.target.value)} /></label>
          <div className="row" style={{ marginTop: 10, marginBottom: 0 }}><button className="btn danger" disabled={!!busy || !reason.trim()} onClick={() => act('suspend', { action: 'suspend', reason }, 'PATCH', 'Organization suspended.')}>Suspend</button></div>
        </>}
      </div>
      <div className="card" style={{ borderColor: '#f3c4c5' }}>
        <h3 className="err">Delete organization</h3>
        <p className="small">Permanently deletes <b>{org.name}</b>: all {data.employees + data.archived} employee records, attendance, payslips, leave, settings, its {data.members.length} logins and its billing records. An active Stripe subscription is cancelled first. <b>This cannot be undone.</b> Files in Google Drive stay (remove its folders by hand).</p>
        <label className="small" style={{ display: 'block' }}>Type <code>{org.slug}</code> to confirm<input className="field" style={{ width: '100%' }} value={confirmSlug} onChange={e => setConfirmSlug(e.target.value)} autoComplete="off" /></label>
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="btn danger" disabled={!!busy || confirmSlug !== org.slug} onClick={() => act('delete', { confirm: confirmSlug }, 'DELETE', 'Deleted.')}>{busy === 'delete' ? 'Deleting…' : 'Delete forever'}</button>
        </div>
      </div>
    </div>
  );
}
