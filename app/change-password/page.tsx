'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== again) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    const res = await fetch('/api/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error ?? 'Could not change the password.'); setBusy(false); return; }
    router.replace('/');
    router.refresh();
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="logo">HR</div>
        <h1>Set a new password</h1>
        <p className="sub">Choose a password only you know (8+ characters).</p>
        <label>New password
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required minLength={8} autoFocus />
        </label>
        <label>Repeat it
          <input type="password" value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" required />
        </label>
        {error && <p className="err" style={{ marginTop: 0 }}>{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        <p className="small" style={{ textAlign: 'center', marginBottom: 0 }}><a href="/">Back</a></p>
      </form>
    </div>
  );
}
