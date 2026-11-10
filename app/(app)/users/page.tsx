'use client';

import { ErrorBox } from '@/components/ui';
import { useMemo, useState } from 'react';
import { useApp } from '@/components/AppContext';
import { Modal } from '@/components/Modal';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { fmtDate } from '@/lib/dates';
import { defaultPassword, suggestUsername, cleanUsername } from '@/lib/username';
import type { Employee, Profile, Role } from '@/lib/types';

const ROLES: Role[] = ['admin', 'editor', 'viewer', 'team_lead', 'employee'];
const ROLE_NAME: Record<Role, string> = { admin: 'Admin (HR)', editor: 'Editor (HR)', viewer: 'Viewer (HR)', team_lead: 'Team leader', employee: 'Employee' };
const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including user access and company settings',
  editor: 'View, import, edit attendance, generate payslips, approve leave',
  viewer: 'View only (employees, attendance, payslips)',
  team_lead: 'Employee panel + their team (set under Teams & hierarchy): details, attendance, payslips, leave approval',
  employee: 'Own profile, payslips and attendance; apply for leave',
};
const needsEmp = (r: Role) => r === 'team_lead' || r === 'employee';

type Emp = Pick<Employee, 'id' | 'emp_code' | 'name' | 'archived_at'>;

export default function UsersPage() {
  const { profile, isAdmin, notify } = useApp();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [role, setRole] = useState<Role>('employee');
  const [empId, setEmpId] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cred, setCred] = useState<{ username: string; password: string; what: string } | null>(null);
  const [pwFor, setPwFor] = useState<Profile | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number; made: { name: string; username: string; password: string }[]; failed: string[] } | null>(null);
  const [q, setQ] = useState('');

  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [users, emps] = await Promise.all([
      sb.from('profiles').select('*').order('created_at'),
      fetchAll<Emp>((a, b) => sb.from('employees').select('id, emp_code, name, archived_at').order('emp_code').range(a, b)),
    ]);
    if (users.error) throw new Error(users.error.message);
    return { users: users.data as Profile[], emps };
  }, []);
  const users = data?.users ?? [];
  const emps = data?.emps ?? [];
  const empBy = useMemo(() => new Map(emps.map(e => [e.id, e])), [emps]);
  const linked = useMemo(() => new Set(users.map(u => u.employee_id).filter(Boolean) as string[]), [users]);
  const unlinkedActive = emps.filter(e => !e.archived_at && !linked.has(e.id));
  const shown = users.filter(u => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const e = u.employee_id ? empBy.get(u.employee_id) : undefined;
    return [u.full_name, u.username, u.role, e?.emp_code, e?.name].some(x => (x ?? '').toLowerCase().includes(t));
  });

  if (!isAdmin) return <div className="note">Only admins can manage user access.</div>;

  async function call(method: 'POST' | 'PATCH', body: object, quiet = false) {
    const res = await fetch('/api/users', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { if (!quiet) notify(json.error ?? 'Something went wrong', 'err'); return { error: (json.error as string) ?? 'Failed' } as { error: string }; }
    return json;
  }

  function pickEmployee(id: string) {
    setEmpId(id);
    const e = empBy.get(id);
    if (e) { setFullName(e.name); if (!touched) setUsername(cleanUsername(e.emp_code)); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (needsEmp(role) && !empId) { notify('Pick the employee this login belongs to.', 'err'); return; }
    setBusy(true);
    const r = await call('POST', { full_name: fullName, username, role, must_change_password: mustChange, employee_id: empId || null });
    setBusy(false);
    if (r.error) return;
    setCred({ username: r.username, password: r.password, what: 'New login created' });
    setFullName(''); setUsername(''); setTouched(false); setEmpId('');
    reload();
  }

  /** One employee login per active employee that has none: username = employee ID in lowercase. */
  async function createAll() {
    if (!unlinkedActive.length) return;
    if (!confirm(`Create an Employee login for ${unlinkedActive.length} employee(s) who have none?\n\nUsername = their employee ID in lowercase (e.g. isftd0007), password = the default pattern (e.g. Isftd0007@isft). They must choose their own password at first login.`)) return;
    const made: { name: string; username: string; password: string }[] = [];
    const failed: string[] = [];
    setBulk({ done: 0, total: unlinkedActive.length, made, failed });
    for (const [i, e] of unlinkedActive.entries()) {
      const r = await call('POST', { full_name: e.name, username: cleanUsername(e.emp_code), role: 'employee', must_change_password: true, employee_id: e.id }, true);
      if (r.error) failed.push(`${e.name} (${e.emp_code}): ${r.error}`); else made.push({ name: e.name, username: r.username, password: r.password });
      setBulk({ done: i + 1, total: unlinkedActive.length, made: [...made], failed: [...failed] });
    }
    reload();
  }

  async function act(u: Profile, action: string, extra: object = {}) {
    if (action === 'reset_password' && !confirm(`Reset ${u.full_name}'s password to the default (${defaultPassword(u.username)})? They will have to choose a new one at next login.`)) return;
    if (action === 'deactivate' && !confirm(`Disable ${u.full_name}'s login? They will be logged out and cannot sign in until you enable it again.`)) return;
    const r = await call('PATCH', { id: u.id, action, ...extra });
    if (r.error) { reload(); return; }
    if (r.password) setCred({ username: r.username, password: r.password, what: 'Password changed' });
    else notify('Done');
    reload();
  }

  const previewUser = cleanUsername(username);
  const empLabel = (e: Emp) => `${e.emp_code} — ${e.name}${e.archived_at ? ' (inactive)' : ''}`;

  return (
    <>
      <div className="card">
        <h3>Give someone access</h3>
        <form onSubmit={create}>
          <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
            <label>Access level
              <select value={role} onChange={e => setRole(e.target.value as Role)}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
              </select>
              <span className="hint">{ROLE_HELP[role]}</span>
            </label>
            <label>Employee{needsEmp(role) ? ' *' : ' (optional)'}
              <select value={empId} onChange={e => pickEmployee(e.target.value)}>
                <option value="">{needsEmp(role) ? 'Pick the employee…' : '— not an employee —'}</option>
                {emps.filter(e => !linked.has(e.id) && !e.archived_at).map(e => <option key={e.id} value={e.id}>{empLabel(e)}</option>)}
              </select>
              <span className="hint">{needsEmp(role) ? 'They will only see this employee’s data (and their team’s, for team leaders).' : 'Link HR staff too, so they can apply for their own leave.'}</span>
            </label>
            <label>Full name
              <input value={fullName} required placeholder="Jaskaran Singh" onChange={e => { setFullName(e.target.value); if (!touched) setUsername(suggestUsername(e.target.value)); }} />
            </label>
            <label>Username
              <input value={username} required onChange={e => { setUsername(cleanUsername(e.target.value)); setTouched(true); }} />
              <span className="hint">Lowercase letters and digits</span>
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
        <div className="row" style={{ marginTop: 16, marginBottom: 0 }}>
          <button className="btn" disabled={!unlinkedActive.length || (!!bulk && bulk.done < bulk.total)} onClick={createAll}>
            Create employee logins for everyone without one ({unlinkedActive.length})
          </button>
          {bulk && <span className="muted small">{bulk.done < bulk.total ? `Creating ${bulk.done} / ${bulk.total}…` : `Done: ${bulk.made.length} created${bulk.failed.length ? `, ${bulk.failed.length} failed` : ''}.`}</span>}
        </div>
        {bulk && bulk.done === bulk.total && (bulk.made.length > 0 || bulk.failed.length > 0) && (
          <div className="cred">
            {bulk.made.length > 0 && <>
              <b>New logins</b> (copy and share; each person must set their own password at first login)
              <div style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => navigator.clipboard?.writeText(bulk.made.map(m => `${m.name}\tUsername: ${m.username}\tPassword: ${m.password}`).join('\n')).then(() => notify('Copied'))}>Copy all</button>{' '}
                <button className="btn sm" onClick={() => setBulk(null)}>Hide</button>
              </div>
            </>}
            {bulk.failed.length > 0 && <p className="err small">{bulk.failed.slice(0, 10).join(' · ')}{bulk.failed.length > 10 ? ' …' : ''}</p>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Everyone with access</h3>
          <span className="sp" />
          <input className="field" placeholder="Filter by name, username, ID…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Access</th><th>Employee</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {shown.map(u => {
                const me = u.id === profile.id;
                return (
                  <tr key={u.id}>
                    <td><b>{u.full_name}</b>{me && <span className="muted small"> (you)</span>}</td>
                    <td>{u.username}</td>
                    <td>
                      <select value={u.role} disabled={me} onChange={e => act(u, 'set_role', { role: e.target.value })}>
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={u.employee_id ?? ''} onChange={e => act(u, 'set_employee', { employee_id: e.target.value || null })} style={{ maxWidth: 220 }}>
                        <option value="">— none —</option>
                        {emps.filter(e => e.id === u.employee_id || !linked.has(e.id)).map(e => <option key={e.id} value={e.id}>{empLabel(e)}</option>)}
                      </select>
                    </td>
                    <td>{!u.active ? <span className="pill bad">Disabled</span> : u.must_change_password ? <span className="pill warn">Hasn&apos;t set own password</span> : <span className="pill ok">Active</span>}</td>
                    <td>{fmtDate(u.created_at)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn sm" onClick={() => setPwFor(u)}>Set password</button>{' '}
                      <button className="btn sm" onClick={() => act(u, 'reset_password')}>Reset to default</button>{' '}
                      {u.active
                        ? <button className="btn sm danger" disabled={me} onClick={() => act(u, 'deactivate')}>Disable</button>
                        : <button className="btn sm" onClick={() => act(u, 'activate')}>Enable</button>}
                    </td>
                  </tr>
                );
              })}
              {!shown.length && !loading && <tr><td colSpan={7} className="muted">No users.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {pwFor && <SetPassword user={pwFor} self={pwFor.id === profile.id} onClose={() => setPwFor(null)}
        onSave={async (password, must) => { await act(pwFor, 'set_password', { password, must_change_password: must }); setPwFor(null); }} />}
    </>
  );
}

function SetPassword({ user, self, onClose, onSave }: {
  user: Profile; self: boolean; onClose: () => void; onSave: (password: string, mustChange: boolean) => Promise<void>;
}) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [must, setMust] = useState(!self);
  const [busy, setBusy] = useState(false);
  const random = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const a = crypto.getRandomValues(new Uint32Array(10));
    setPw(Array.from(a, n => chars[n % chars.length]).join('') + '#' + (a[0] % 90 + 10)); setShow(true);
  };
  return (
    <Modal title={`Set password — ${user.full_name}`} onClose={onClose}>
      <form onSubmit={async e => { e.preventDefault(); setBusy(true); await onSave(pw.trim(), must); setBusy(false); }}>
        <div className="mgrid" style={{ gridTemplateColumns: '1fr' }}>
          <label>New password
            <div className="pw-field">
              <input type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} minLength={8} required autoFocus autoComplete="new-password" />
              <button type="button" className="pw-eye" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'} tabIndex={-1}>{show ? '🙈' : '👁️'}</button>
            </div>
            <span className="hint">At least 8 characters. <a href="#" onClick={e => { e.preventDefault(); random(); }}>Generate a random one</a></span>
          </label>
          {!self && (
            <label className="small muted" style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={must} onChange={e => setMust(e.target.checked)} /> Ask them to choose their own password after logging in with this one
            </label>
          )}
        </div>
        <div className="mfoot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || pw.trim().length < 8}>{busy ? 'Saving…' : 'Set password'}</button>
        </div>
      </form>
    </Modal>
  );
}
