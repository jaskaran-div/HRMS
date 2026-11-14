'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/organizations', label: 'Organizations' },
  { href: '/admin/payments', label: 'Payments' },
];

export function AdminNav() {
  const path = usePathname();
  const on = (h: string) => (h === '/admin' ? path === h : path.startsWith(h));
  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <div className="tabs" style={{ margin: 0 }}>
        {ITEMS.map(i => <Link key={i.href} href={i.href} className={on(i.href) && !(i.href === '/admin/organizations' && path.endsWith('/new')) ? 'on' : ''}>{i.label}</Link>)}
      </div>
      <span className="sp" style={{ flex: 1 }} />
      <Link className="btn primary" href="/admin/organizations/new">+ New organization</Link>
    </div>
  );
}

/** PATCH / POST / DELETE to the admin API; throws the server's message. */
export async function adminCall(url: string, method: 'POST' | 'PATCH' | 'DELETE', body: object) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
  return j;
}
