'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/ui';

/** Web-only organization registration. The registrant becomes the organization's owner. */
export default function RegisterPage() {
  const [f, setF] = useState({ org_name: '', full_name: '', email: '', password: '', phone: '', country: '', employees: '', website: '' });
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ emailed: boolean; mailError?: string } | null>(null);
  const [resent, setResent] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== again) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? 'Could not register.'); setBusy(false); return; }
      setDone({ emailed: !!j.emailed, mailError: j.mailError });
    } catch {
      setError('Could not reach the server. Check your internet connection.');
    }
    setBusy(false);
  }

  async function resend() {
    const r = await fetch('/api/register/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email }) });
    const j = await r.json().catch(() => ({}));
    setResent(j.message ?? j.error ?? 'Sent.');
  }

  if (done) return (
    <div className="login-wrap">
      <div className="public-card">
        <h1>Check your inbox</h1>
        <p className="sub">We sent a verification link to <b>{f.email}</b>. Open it to confirm your email, then log in to choose your plan.</p>
        {!done.emailed && <p className="note warn">{done.mailError}</p>}
        <div className="row">
          <button className="btn" onClick={resend}>Resend the link</button>
          <Link className="btn primary" href="/login">Go to login</Link>
        </div>
        {resent && <p className="muted small">{resent}</p>}
      </div>
    </div>
  );

  return (
    <div className="login-wrap">
      <div className="public-card">
        <h1>Register your organization</h1>
        <p className="sub">You become the organization’s owner. After verifying your email you choose a plan and pay securely with Stripe; then you invite your HR team and employees.</p>
        {error && <p className="err-line" role="alert"><Icon name="alert" size={16} />{error}</p>}
        <form onSubmit={submit}>
          <label>Organization name<input value={f.org_name} onChange={set('org_name')} required minLength={2} autoFocus /></label>
          <label>Your full name<input value={f.full_name} onChange={set('full_name')} required minLength={2} autoComplete="name" /></label>
          <label>Work email<input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
          <div className="mgrid">
            <label>Password<input type="password" value={f.password} onChange={set('password')} required minLength={10} autoComplete="new-password" /><span className="hint">At least 10 characters</span></label>
            <label>Repeat password<input type="password" value={again} onChange={e => setAgain(e.target.value)} required autoComplete="new-password" /></label>
          </div>
          <div className="mgrid">
            <label>Phone (optional)<input value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
            <label>Country (optional)<input value={f.country} onChange={set('country')} autoComplete="country-name" /></label>
            <label>Employees (approx.)<input type="number" min={1} value={f.employees} onChange={set('employees')} /></label>
          </div>
          {/* honeypot: hidden from people, filled by bots */}
          <div className="hp" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
          <button className="btn primary" disabled={busy}>{busy ? <><Spinner size={16} /> Creating…</> : 'Create organization'}</button>
        </form>
        <p className="foot">Already registered? <Link href="/login">Log in</Link> · Large team or special needs? <Link href="/contact-sales">Contact Sales</Link></p>
      </div>
    </div>
  );
}
