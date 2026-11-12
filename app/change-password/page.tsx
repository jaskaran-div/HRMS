'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/ui';

export default function ChangePasswordPage() {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== again) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Could not change the password.'); setBusy(false); return; }
      setDone(true);
      setTimeout(() => window.location.replace('/'), 900); // full load: the loader shows instead of a blank page
    } catch {
      setError('Could not reach the server. Check your internet connection.');
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-shell single">
        <form className="login" onSubmit={submit}>
          <div className="logo"><Icon name="lock" size={24} /></div>
          <h1>Set a new password</h1>
          <p className="sub">Choose a password only you know — at least 8 characters.</p>
          {error && <p className="err-line" role="alert"><Icon name="alert" size={16} />{error}</p>}
          {done && <p className="err-line ok" role="status"><Icon name="checkCircle" size={16} />Password changed. Taking you in…</p>}
          <label>New password
            <div className="pw-field">
              <input type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required minLength={8} autoFocus />
              <button type="button" className="pw-eye" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'} tabIndex={-1}><Icon name={show ? 'eyeOff' : 'eye'} size={17} /></button>
            </div>
          </label>
          <label>Repeat it
            <input type={show ? 'text' : 'password'} value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" required />
          </label>
          <button className="btn primary" disabled={busy || done}>{busy ? <><Spinner size={16} /> Saving…</> : 'Save password'}</button>
          <p className="login-foot"><a href="/">Back</a></p>
        </form>
      </div>
    </div>
  );
}
