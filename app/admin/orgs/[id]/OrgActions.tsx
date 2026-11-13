'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ALL_FEATURES, FEATURE_LABEL, type Feature } from '@/lib/billing/catalog';

/** Controlled management for one organization. Every action is written to that organization's audit log. */
export function OrgActions({ id, status, exempt, overrides }: { id: string; status: string; exempt: boolean; overrides: { grant: string[]; revoke: string[] } }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [grant, setGrant] = useState(new Set(overrides.grant));
  const [revoke, setRevoke] = useState(new Set(overrides.revoke));
  const [reason, setReason] = useState('');

  async function act(action: string, extra: object = {}) {
    setBusy(action); setMsg(null);
    const r = await fetch(`/api/admin/orgs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason, ...extra }) });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    setMsg(r.ok ? { ok: true, text: 'Done.' } : { ok: false, text: j.error ?? 'Failed' });
    if (r.ok) router.refresh();
  }
  const flip = (set: Set<string>, setter: (s: Set<string>) => void, f: Feature) => { const n = new Set(set); if (n.has(f)) n.delete(f); else n.add(f); setter(n); };

  return (
    <div className="card">
      <h3>Manage</h3>
      {msg && <div className={`note ${msg.ok ? 'ok' : 'bad'}`} style={{ marginBottom: 12 }}>{msg.text}</div>}
      <label className="small" style={{ display: 'block', marginBottom: 12 }}>Reason (stored in the organization’s audit log)
        <input className="field" style={{ width: '100%' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. invoiced offline, ticket #123" />
      </label>
      <div className="row">
        <button className="btn" disabled={!!busy} onClick={() => act('sync')}>{busy === 'sync' ? 'Syncing…' : 'Sync from Stripe'}</button>
        <button className="btn" disabled={!!busy} onClick={() => act('exempt', { value: !exempt })}>{exempt ? 'Remove billing exemption' : 'Make billing exempt'}</button>
        {status === 'suspended'
          ? <button className="btn" disabled={!!busy} onClick={() => act('unsuspend')}>Unsuspend</button>
          : <button className="btn danger" disabled={!!busy || !reason.trim()} onClick={() => act('suspend')} title={reason.trim() ? '' : 'Enter a reason first'}>Suspend</button>}
      </div>
      <h4 style={{ margin: '8px 0' }}>Entitlement overrides</h4>
      <p className="muted small" style={{ marginTop: 0 }}>Grant adds a feature without payment; revoke removes one even if paid. Paid add-ons themselves come from Stripe.</p>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Feature</th><th>Grant</th><th>Revoke</th></tr></thead>
        <tbody>{ALL_FEATURES.map(f => (
          <tr key={f}><td>{FEATURE_LABEL[f]}</td>
            <td><input type="checkbox" checked={grant.has(f)} onChange={() => flip(grant, setGrant, f)} /></td>
            <td><input type="checkbox" checked={revoke.has(f)} onChange={() => flip(revoke, setRevoke, f)} /></td></tr>
        ))}</tbody>
      </table></div>
      <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
        <button className="btn primary" disabled={!!busy} onClick={() => act('entitlements', { grant: [...grant], revoke: [...revoke] })}>{busy === 'entitlements' ? 'Saving…' : 'Save overrides'}</button>
      </div>
    </div>
  );
}
