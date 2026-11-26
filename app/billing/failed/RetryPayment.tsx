'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Spinner } from '@/components/ui';
import { startCheckout, TOKEN_KEY } from '@/lib/billing/start-checkout';

/** Try again: with the token from registration (same tab), or as the logged-in owner, else via login → Billing. */
export function RetryPayment({ loggedIn }: { loggedIn: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setToken(sessionStorage.getItem(TOKEN_KEY)), []);
  const canRetry = loggedIn || !!token;

  async function retry() {
    setBusy(true); setError('');
    setError(await startCheckout(loggedIn ? null : token));
    setBusy(false);
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {error && <p className="note bad">{error}</p>}
      {canRetry
        ? <button className="btn primary" onClick={retry} disabled={busy}>{busy ? <><Spinner size={16} /> Opening secure payment…</> : 'Try the payment again'}</button>
        : <Link className="btn primary" href="/login">Log in to subscribe</Link>}
      {loggedIn && <Link className="btn" href="/billing">Back to Billing</Link>}
      <Link className="btn" href="/pricing">See the plan</Link>
    </div>
  );
}
