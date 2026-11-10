'use client';

import { useEffect } from 'react';
import { Icon } from './Icon';
import { friendlyError } from '@/lib/use-load';

/** Shown when a page crashes or its data cannot be loaded; offers a retry instead of a blank screen. */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', padding: 34 }}>
      <div className="empty-ic" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}><Icon name="alert" size={26} /></div>
      <h2 style={{ margin: '10px 0 6px', fontSize: 19 }}>This page could not be loaded</h2>
      <p className="muted" style={{ marginTop: 0 }}>{friendlyError(error)}</p>
      {error.digest && <p className="muted small">Reference: {error.digest}</p>}
      <div className="row" style={{ justifyContent: 'center', marginBottom: 0 }}>
        <button className="btn primary" onClick={reset}><Icon name="refresh" size={15} /> Try again</button>
        <a className="btn" href="/">Go to the start page</a>
      </div>
    </div>
  );
}
