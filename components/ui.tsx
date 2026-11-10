'use client';

import { Icon } from './Icon';
import { useGlobalBusy } from '@/lib/use-load';

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
}

/** Centered spinner with a short message, for whole sections that are loading. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status"><Spinner size={22} /><span>{label}</span></div>;
}

/** Grey placeholder blocks shaped like the content that is on its way. */
export function Skeleton({ rows = 5, cards = 0 }: { rows?: number; cards?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {cards > 0 && <div className="kpis">{Array.from({ length: cards }, (_, i) => <div key={i} className="kpi sk-card"><div className="sk" style={{ width: '50%' }} /><div className="sk" style={{ width: '35%', height: 22, marginTop: 10 }} /></div>)}</div>}
      <div className="card">
        <div className="sk" style={{ width: '30%', height: 16, marginBottom: 18 }} />
        {Array.from({ length: rows }, (_, i) => <div key={i} className="sk" style={{ width: `${92 - (i % 3) * 14}%`, marginBottom: 14 }} />)}
      </div>
    </div>
  );
}

/** A clear error with a way out: Retry (and the technical message, small, for support). */
export function ErrorBox({ message, onRetry, title = 'Something went wrong' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div className="errbox" role="alert">
      <Icon name="alert" size={20} />
      <div style={{ flex: 1 }}><b>{title}</b><div className="small">{message}</div></div>
      {onRetry && <button className="btn sm" onClick={onRetry}><Icon name="refresh" size={14} /> Retry</button>}
    </div>
  );
}

export function Empty({ icon = 'folder', title, children }: { icon?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic"><Icon name={icon} size={26} /></div>
      <h2>{title}</h2>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/** Thin animated bar at the very top while anything on the page is loading. */
export function TopProgress() {
  const busy = useGlobalBusy();
  return <div className={`topprogress ${busy ? 'on' : ''}`} aria-hidden />;
}
