'use client';

import { useState } from 'react';

export function ResendVerification({ email: initial }: { email: string }) {
  const [email, setEmail] = useState(initial);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch('/api/register/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const j = await r.json().catch(() => ({}));
    setMsg(j.message ?? j.error ?? 'Sent.');
    setBusy(false);
  }
  return (
    <form onSubmit={send}>
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required readOnly={!!initial} /></label>
      <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send a new link'}</button>
      {msg && <p className="muted small">{msg}</p>}
    </form>
  );
}
