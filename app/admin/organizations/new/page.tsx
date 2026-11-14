'use client';

import { useState } from 'react';
import Link from 'next/link';
import { adminCall } from '../../AdminNav';
import { PlanFields, planFrom, type Plan } from '../../PlanFields';

/** Platform admin creates an organization and its owner login. */
export default function NewOrganization() {
  const [f, setF] = useState({ org_name: '', full_name: '', email: '', password: '', phone: '', country: '' });
  const [plan, setPlan] = useState<Plan>(planFrom(null));
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ id: string; email: string; password: string | null; mail: { ok: boolean; error?: string } | null } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { setDone(await adminCall('/api/admin/orgs', 'POST', { ...f, ...plan, send_email: sendEmail })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    setBusy(false);
  }

  if (done) return (
    <div className="card">
      <h3>Organization created</h3>
      <p>The owner logs in at <code>/login</code> with <b>{done.email}</b>{done.password ? <> and the password <b>{done.password}</b> (shown only now — copy it)</> : ' and the password you set'}.</p>
      {done.mail && (done.mail.ok ? <p className="note ok">Login details emailed to the owner.</p> : <p className="note warn">Email not sent: {done.mail.error}. Share the details yourself.</p>)}
      <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
        <Link className="btn primary" href={`/admin/organizations/${done.id}`}>Open the organization</Link>
        <button className="btn" onClick={() => { setDone(null); setF({ org_name: '', full_name: '', email: '', password: '', phone: '', country: '' }); setPlan(planFrom(null)); }}>Create another</button>
      </div>
    </div>
  );

  return (
    <form onSubmit={submit}>
      {error && <div className="note bad" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="card">
        <h3>Organization</h3>
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          <label>Organization name *<input value={f.org_name} onChange={set('org_name')} required /></label>
          <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
          <label>Country<input value={f.country} onChange={set('country')} /></label>
        </div>
      </div>
      <div className="card">
        <h3>Owner login</h3>
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          <label>Owner name *<input value={f.full_name} onChange={set('full_name')} required /></label>
          <label>Owner email *<input type="email" value={f.email} onChange={set('email')} required /><span className="hint">They log in with this email, on the web and in the app.</span></label>
          <label>Password<input value={f.password} onChange={set('password')} minLength={10} placeholder="Blank = generate one" /><span className="hint">At least 10 characters.</span></label>
        </div>
        <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12 }}>
          <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} /> Email the login details to the owner
        </label>
      </div>
      <div className="card">
        <h3>Plan, features and limits</h3>
        <PlanFields plan={plan} onChange={setPlan} />
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button>
        <Link className="btn" href="/admin/organizations">Cancel</Link>
      </div>
    </form>
  );
}
