'use client';

import { useState } from 'react';
import { useApp } from '@/components/AppContext';
import { ErrorBox } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useLoad } from '@/lib/use-load';

interface Row { id: string; actor_name: string | null; action: string; target_type: string | null; target_label: string | null; details: Record<string, unknown>; ip: string | null; created_at: string }

const GROUPS: Record<string, string> = { '': 'Everything', user: 'Users & roles', invitation: 'Invitations', ownership: 'Ownership', billing: 'Billing', org: 'Organization', platform: 'Platform admin' };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Read-only organization audit log (Row Level Security: owner / admin of this organization). */
export default function AuditPage() {
  const { isAdmin } = useApp();
  const [group, setGroup] = useState('');
  const [limit, setLimit] = useState(100);
  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabaseBrowser().from('org_audit_logs').select('id, actor_name, action, target_type, target_label, details, ip, created_at').order('created_at', { ascending: false }).limit(limit);
    if (group) q = q.like('action', `${group}.%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as Row[];
  }, [group, limit]);

  if (!isAdmin) return <div className="note">Only the owner and admins can see the audit log.</div>;
  return (
    <div className="card">
      <div className="row">
        <select value={group} onChange={e => setGroup(e.target.value)}>
          {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="sp" />
        <span className="muted small">Entries cannot be edited or deleted.</span>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>
            {(data ?? []).map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{when(r.created_at)}</td>
                <td>{r.actor_name ?? '—'}{r.ip && <div className="muted small">{r.ip}</div>}</td>
                <td><code>{r.action}</code></td>
                <td>{r.target_label ?? (r.target_type ? r.target_type : '—')}</td>
                <td className="small muted" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{Object.keys(r.details ?? {}).length ? JSON.stringify(r.details) : ''}</td>
              </tr>
            ))}
            {!loading && data && !data.length && <tr><td colSpan={5} className="muted">Nothing logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && data.length >= limit && <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={() => setLimit(l => l + 200)}>Load more</button></div>}
    </div>
  );
}
