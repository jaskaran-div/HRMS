'use client';

import { useState } from 'react';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useLoad } from '@/lib/use-load';
import { fmtDate } from '@/lib/dates';
import { defaultPassword, suggestUsername, cleanUsername } from '@/lib/username';
import type { Profile, Role } from '@/lib/types';

const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including user access and company settings',
  editor: 'View, import, edit attendance and generate payslips',
  viewer: 'View only (employees, attendance, payslips)',
};

export default function UsersPage() {
  const { profile, isAdmin, notify } = useApp();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [role, setRole] = useState<Role>('editor');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cred, setCred] = useState<{ username: string; password: string; what: string } | null>(null);

  const { data: users = [], loading, error, reload } = useLoad(async () => {
    const { data, error } = await supabaseBrowser().from('profiles').select('*').order('created_at');
    if (error) throw new Error(error.message);
    return data as Profile[];
  }, []);

  if (!isAdmin) return <div className="note">Only admins can manage user access.</div>;

  async function call(method: 'POST' | 'PATCH', body: object) {
    const res = await fetch('/api/users', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { notify(json.error ?? 'Something went wrong', 'err'); return null; }
    return json;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call('POST', { full_name: fullName, username, role, must_change_password: mustChange });
    setBusy(false);
    if (!r) return;
    setCred({ username: r.username, password: r.password, what: 'New login created' });
    setFullName(''); setUsername(''); setTouched(false);
    reload();
  }

  async function act(u: Profile, action: string, extra: object = {}) {
    if (action === 'reset_password' && !confirm(`Reset ${u.full_name}'s password to the default (${defaultPassword(u.username)})? They will have to choose a new one at next login.`)) return;
    if (action === 'deactivate' && !confirm(`Disable ${u.full_name}'s login? They will be logged out and cannot sign in until you enable it again.`)) return;
    const r = await call('PATCH', { id: u.id, action, ...extra });
    if (!r) return;
    if (r.password) setCred({ username: r.username, password: r.password, what: 'Password reset' });
    else notify('Done');
    reload();
  }

  const previewUser = cleanUsername(username);

  return (
    <>
      <div className="card">
        <h3>Give someone access</h3>
        <form onSubmit={create}>
          <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
            <label>Full name
              <input value={fullName} required placeholder="Jaskaran Singh" onChange={e => { setFullName(e.target.value); if (!touched) setUsername(suggestUsername(e.target.value)); }} />
            </label>
            <label>Username
              <input value={username} required onChange={e => { setUsername(cleanUsername(e.target.value)); setTouched(true); }} />
              <span className="hint">Lowercase letters and digits</span>
            </label>
            <label>Access level
              <select value={role} onChange={e => setRole(e.target.value as Role)}>
                {(['admin', 'editor', 'viewer'] as Role[]).map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
              </select>
              <span className="hint">{ROLE_HELP[role]}</span>
            </label>
          </div>
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" disabled={busy || !previewUser}>{busy ? 'Creating…' : 'Create login'}</button>
            {previewUser && <span className="muted small">Password will be <b>{defaultPassword(previewUser)}</b></span>}
            <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={mustChange} onChange={e => setMustChange(e.target.checked)} /> Ask them to choose their own password at first login
            </label>
          </div>
        </form>
        {cred && (
          <div className="cred">
            <b>{cred.what}.</b> Share these details with them:<br />
            Username: <b>{cred.username}</b><br />Password: <b>{cred.password}</b>
            <div style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(`Username: ${cred.username}\nPassword: ${cred.password}`).then(() => notify('Copied'))}>Copy</button>{' '}
              <button className="btn sm" onClick={() => setCred(null)}>Hide</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Everyone with access</h3>
        {error && <p className="err">{error}</p>}
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Access</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {users.map(u => {
                const me = u.id === profile.id;
                return (
                  <tr key={u.id}>
                    <td><b>{u.full_name}</b>{me && <span className="muted small"> (you)</span>}</td>
                    <td>{u.username}</td>
                    <td>
                      <select value={u.role} disabled={me} onChange={e => act(u, 'set_role', { role: e.target.value })}>
                        <option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
                      </select>
                    </td>
                    <td>{!u.active ? <span className="pill bad">Disabled</span> : u.must_change_password ? <span className="pill warn">Hasn&apos;t set own password</span> : <span className="pill ok">Active</span>}</td>
                    <td>{fmtDate(u.created_at)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn sm" onClick={() => act(u, 'reset_password')}>Reset password</button>{' '}
                      {u.active
                        ? <button className="btn sm danger" disabled={me} onClick={() => act(u, 'deactivate')}>Disable</button>
                        : <button className="btn sm" onClick={() => act(u, 'activate')}>Enable</button>}
                    </td>
                  </tr>
                );
              })}
              {!users.length && !loading && <tr><td colSpan={6} className="muted">No users.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
