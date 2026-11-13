'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { ErrorBox } from '@/components/ui';
import { ask } from '@/components/Dialog';
import { useLoad } from '@/lib/use-load';
import { fmtDate } from '@/lib/dates';
import { ROLE_LABEL } from '@/lib/roles';
import { STATUS_LABEL } from '@/lib/org';
import type { Role } from '@/lib/types';

interface Cand { id: string; role: Role; full_name: string; username: string; email: string | null }

/** Organization details and the secure ownership transfer (owner starts, the new owner accepts). */
export default function OrganizationPage() {
  const { org, profile, isAdmin, isOwner, notify } = useApp();
  const [to, setTo] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const { data, error, reload } = useLoad(async () => {
    const r = await fetch('/api/org/ownership');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? 'Could not load');
    return j as { pending: { to_user_id: string; expires_at: string } | null; candidates: Cand[] };
  }, []);

  if (!isAdmin) return <div className="note">Only the owner and admins can see this page.</div>;

  async function call(body: object) {
    setBusy(true);
    const r = await fetch('/api/org/ownership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { notify(j.error ?? 'Failed', 'err'); return null; }
    return j;
  }
  async function start(e: React.FormEvent) {
    e.preventDefault();
    const c = data?.candidates.find(x => x.id === to);
    if (!c || !(await ask.confirm({ title: `Offer ownership to ${c.full_name}?`, tone: 'warn', confirmText: 'Send offer',
      message: 'They must accept while logged in. Once they do, they control billing and ownership and you become an admin.' }))) return;
    const j = await call({ action: 'start', to_user_id: to, password });
    if (!j) return;
    setPassword('');
    if (j.mail?.ok) { notify('Offer sent by email'); setLink(null); } else { notify(`Offer created, but the email was not sent: ${j.mail?.error}`, 'err'); setLink(j.link ?? null); }
    reload();
  }

  const pendingTo = data?.pending ? data.candidates.find(c => c.id === data.pending!.to_user_id) : null;
  return (
    <>
      <div className="card">
        <h3>{org.name}</h3>
        <dl className="kv">
          <dt>Status</dt><dd>{STATUS_LABEL[org.status]}</dd>
          <dt>Your role</dt><dd>{ROLE_LABEL[profile.role]}</dd>
        </dl>
        {isOwner && <p className="muted small" style={{ marginBottom: 0 }}>Subscription and add-ons: <Link href="/billing">Billing</Link>.</p>}
      </div>

      <div className="card">
        <h3>Transfer ownership</h3>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data?.pending && (
          <div className="note warn" style={{ marginBottom: 12 }}>
            Ownership has been offered to <b>{pendingTo?.full_name ?? 'a member'}</b> until {fmtDate(data.pending.expires_at.slice(0, 10))}.{' '}
            {isOwner && <button className="btn sm" disabled={busy} onClick={async () => { if (await call({ action: 'cancel' })) { notify('Offer cancelled'); reload(); } }}>Cancel offer</button>}
          </div>
        )}
        {!isOwner ? <p className="muted small">Only the owner can transfer ownership.</p> : (
          <form onSubmit={start}>
            <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
              <label>New owner
                <select value={to} onChange={e => setTo(e.target.value)} required>
                  <option value="">Pick an admin or HR admin…</option>
                  {(data?.candidates ?? []).map(c => <option key={c.id} value={c.id}>{c.full_name} ({ROLE_LABEL[c.role]})</option>)}
                </select>
                <span className="hint">Only admins and HR admins of this organization can become owner.</span>
              </label>
              <label>Your password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /><span className="hint">To confirm it is really you.</span></label>
            </div>
            <div className="row" style={{ marginTop: 14, marginBottom: 0 }}><button className="btn danger" disabled={busy || !to}>{busy ? 'Sending…' : 'Offer ownership'}</button></div>
          </form>
        )}
        {link && <div className="cred">Share this one-time link with the new owner (valid 72 hours):<br /><code style={{ wordBreak: 'break-all' }}>{link}</code></div>}
      </div>
    </>
  );
}
