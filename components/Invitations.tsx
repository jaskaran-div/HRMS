'use client';

import { useState } from 'react';
import { useApp } from './AppContext';
import { ErrorBox } from './ui';
import { ask } from './Dialog';
import { useLoad } from '@/lib/use-load';
import { fmtDate } from '@/lib/dates';
import { officialEmailOf } from '@/lib/official-email';
import { assignableRoles, NEEDS_EMPLOYEE, ROLE_HELP, ROLE_LABEL } from '@/lib/roles';
import type { Employee, Role } from '@/lib/types';

type Emp = Pick<Employee, 'id' | 'emp_code' | 'name' | 'email' | 'extra'>;
interface Inv { id: string; email: string; full_name: string; role: Role; status: string; invited_by_name: string | null; expires_at: string; created_at: string }
type Mail = { ok: true } | { ok: false; error: string; link?: string };

/** Invite by email: the person chooses their own password from the link; same login on web and mobile. */
export function Invitations({ emps, onAccepted }: { emps: Emp[]; onAccepted: () => void }) {
  const { profile, notify } = useApp();
  const roles = assignableRoles(profile.role);
  const [role, setRole] = useState<Role>(roles.includes('employee') ? 'employee' : roles[0]);
  const [empId, setEmpId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const { data, error, reload } = useLoad(async () => {
    const r = await fetch('/api/invitations');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? 'Could not load invitations');
    return j.invitations as Inv[];
  }, []);

  const needsEmp = NEEDS_EMPLOYEE.includes(role);
  function pick(id: string) {
    setEmpId(id);
    const e = emps.find(x => x.id === id);
    if (e) { setName(e.name); setEmail(officialEmailOf(e) ?? ''); }
  }

  function mailNote(m: Mail, done: string) {
    if (m.ok) { notify(`${done} — email sent`); setLink(null); return; }
    notify(`${done}, but the email was not sent: ${m.error}`, 'err');
    if (m.link) setLink(m.link);
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch('/api/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), full_name: name.trim(), role, employee_id: empId || null }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { notify(j.error ?? 'Could not invite', 'err'); return; }
    mailNote(j.mail, `Invitation for ${email.trim()} created`);
    setEmpId(''); setName(''); setEmail('');
    reload(); onAccepted();
  }

  async function act(inv: Inv, action: 'resend' | 'revoke') {
    if (action === 'revoke' && !(await ask.confirm({ title: `Revoke the invitation for ${inv.email}?`, danger: true, confirmText: 'Revoke', message: 'The link stops working.' }))) return;
    const r = await fetch('/api/invitations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: inv.id, action }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { notify(j.error ?? 'Failed', 'err'); return; }
    if (action === 'resend') mailNote(j.mail, 'New invitation link created'); else notify('Invitation revoked');
    reload();
  }

  const pill = (s: string, exp: string) => {
    if (s === 'pending' && new Date(exp) < new Date()) return <span className="pill warn">Expired</span>;
    return <span className={`pill ${s === 'accepted' ? 'ok' : s === 'pending' ? 'warn' : 'bad'}`}>{s[0].toUpperCase() + s.slice(1)}</span>;
  };

  return (
    <>
      <div className="card">
        <h3>Invite someone</h3>
        <p className="muted small" style={{ marginTop: 0 }}>They get a secure link (valid 7 days), choose their own password, and use the same email and password on the web and in the mobile app.</p>
        <form onSubmit={invite}>
          <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
            <label>Role
              <select value={role} onChange={e => setRole(e.target.value as Role)}>
                {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <span className="hint">{ROLE_HELP[role]}</span>
            </label>
            <label>Employee{needsEmp ? ' *' : ' (optional)'}
              <select value={empId} onChange={e => pick(e.target.value)} required={needsEmp}>
                <option value="">{needsEmp ? 'Pick the employee…' : '— not an employee —'}</option>
                {emps.map(e => <option key={e.id} value={e.id}>{e.emp_code} — {e.name}</option>)}
              </select>
              <span className="hint">Department, designation and reporting manager come from the employee record (Employees, Teams &amp; hierarchy).</span>
            </label>
            <label>Full name
              <input value={name} required onChange={e => setName(e.target.value)} />
            </label>
            <label>Email
              <input type="email" value={email} required onChange={e => setEmail(e.target.value)} placeholder="name@company.com" />
            </label>
          </div>
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
          </div>
        </form>
        {link && (
          <div className="cred">
            <b>Email could not be sent.</b> Share this one-time link with them yourself (it works once, for 7 days):<br />
            <code style={{ wordBreak: 'break-all' }}>{link}</code>
            <div style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(link).then(() => notify('Copied'))}>Copy</button>{' '}
              <button className="btn sm" onClick={() => setLink(null)}>Hide</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Invitations</h3>
        {error && <ErrorBox message={error} onRetry={reload} />}
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Invited by</th><th>Sent</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map(i => (
                <tr key={i.id}>
                  <td><b>{i.full_name}</b></td><td>{i.email}</td><td>{ROLE_LABEL[i.role]}</td>
                  <td>{pill(i.status, i.expires_at)}</td><td>{i.invited_by_name ?? '—'}</td><td>{fmtDate(i.created_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {(i.status === 'pending' || i.status === 'expired') && roles.includes(i.role) && <>
                      <button className="btn sm" onClick={() => act(i, 'resend')}>Resend</button>{' '}
                      <button className="btn sm danger" onClick={() => act(i, 'revoke')}>Revoke</button>
                    </>}
                  </td>
                </tr>
              ))}
              {data && !data.length && <tr><td colSpan={7} className="muted">No invitations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
