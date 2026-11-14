'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Frame, type NavItem } from '@/components/Shell';
import { Icon } from '@/components/Icon';

const NAV: NavItem[] = [
  { href: '/admin', icon: 'home', label: 'Dashboard', sub: '' },
  { href: '/admin/organizations', icon: 'building', label: 'Organizations', sub: 'Every organization on the platform: plan, limits, members and payments.' },
  { href: '/admin/payments', icon: 'wallet', label: 'Payments', sub: 'Invoices and payments of all organizations.' },
];
const MANAGE: NavItem[] = [
  { href: '/admin/organizations/new', icon: 'plus', label: 'New organization', sub: 'Create an organization with its owner login, plan, features and limits.' },
];

/** The platform admin panel in the same sidebar + top bar as the HR portal. */
export function AdminShell({ platform, user, stripe, children }: {
  platform: string; user: { name: string; email: string }; stripe: { label: string; tone: string; problems: string[] }; children: React.ReactNode;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const search = (
    <form className="search" onSubmit={e => { e.preventDefault(); router.push(`/admin/organizations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`); }}>
      <Icon name="search" size={17} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search organizations by name, owner email, Stripe id…" aria-label="Search organizations" />
    </form>
  );
  return (
    <Frame
      nav={NAV} adminNav={MANAGE} adminTitle="Manage" panelName="Platform admin" search={search}
      brand={{ name: platform, logo: null }} user={{ name: user.name, sub: 'Platform admin' }}
      banner={stripe.problems.length ? <div className="note warn" style={{ marginBottom: 12 }}><b>Stripe is not set up yet</b> — payments and subscriptions stay empty until the keys are added. {stripe.problems.join(' · ')}</div> : null}
      menu={<>
        <div className="mi-head"><b>{user.name}</b><small>{user.email}</small></div>
        <div className="mi-row" style={{ cursor: 'default' }}><Icon name="info" size={16} /> Stripe: {stripe.label}</div>
        <Link href="/" className="mi-row"><Icon name="back" size={16} /> Open my HR portal</Link>
        <form action="/api/logout" method="post"><button className="mi-row danger"><Icon name="logout" size={16} /> Log out</button></form>
      </>}
    >
      {children}
    </Frame>
  );
}

/** PATCH / POST / DELETE to the admin API; throws the server's message. */
export async function adminCall(url: string, method: 'POST' | 'PATCH' | 'DELETE', body: object) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
  return j;
}
