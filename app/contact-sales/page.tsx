'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';

export default function ContactSalesPage() {
  const [f, setF] = useState({ name: '', email: '', company: '', phone: '', employees: '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await fetch('/api/contact-sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(j.error ?? 'Could not send.'); return; }
    setDone(true);
  }

  return (
    <div className="login-wrap">
      <div className="public-card">
        <h1>Contact Sales</h1>
        {done ? <>
          <p className="note ok">Thanks — we have your request and will get back to you soon.</p>
          <p className="foot"><Link href="/login">Back to login</Link></p>
        </> : <>
          <p className="sub">Custom plans, large teams, invoicing or a demo — tell us what you need.</p>
          {error && <p className="err-line" role="alert"><Icon name="alert" size={16} />{error}</p>}
          <form onSubmit={submit}>
            <div className="mgrid">
              <label>Your name<input value={f.name} onChange={set('name')} required /></label>
              <label>Work email<input type="email" value={f.email} onChange={set('email')} required /></label>
              <label>Company<input value={f.company} onChange={set('company')} /></label>
              <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
              <label>Employees<input value={f.employees} onChange={set('employees')} placeholder="e.g. 250" /></label>
            </div>
            <label>How can we help?<textarea rows={5} value={f.message} onChange={set('message')} /></label>
            <div className="hp" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
            <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
          </form>
          <p className="foot"><Link href="/register">Register</Link> · <Link href="/login">Log in</Link></p>
        </>}
      </div>
    </div>
  );
}
