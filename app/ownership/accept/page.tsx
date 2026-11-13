'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function accept() {
    setBusy(true); setError('');
    const r = await fetch('/api/org/ownership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept', token }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(j.error ?? 'Could not accept.'); return; }
    setDone(true);
  }
  return (
    <div className="login-wrap">
      <div className="public-card">
        <h1>Become the owner</h1>
        {done ? <><p className="note ok">You are now the owner. Billing and ownership are yours to manage.</p><p className="foot"><Link href="/billing">Open Billing</Link> · <Link href="/">HR portal</Link></p></> : <>
          <p className="sub">As owner you manage the subscription, add-ons, payments and all administration. The current owner becomes an admin.</p>
          {error && <p className="note bad">{error}</p>}
          <div className="row"><button className="btn primary" onClick={accept} disabled={busy}>{busy ? 'Accepting…' : 'Accept ownership'}</button><Link className="btn" href="/">Not now</Link></div>
        </>}
      </div>
    </div>
  );
}

export default function OwnershipAcceptPage() {
  return <Suspense><Accept /></Suspense>;
}
