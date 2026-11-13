import Link from 'next/link';
import { requirePlatformAdmin } from '@/lib/platform';
import { liveMode, stripeConfigProblems } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/** Platform super admin panel. Not part of any organization; 404 for everyone else. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  const problems = stripeConfigProblems();
  return (
    <div className="solo">
      <div className="solo-top">
        <h1><Link href="/admin" style={{ color: 'inherit', textDecoration: 'none' }}>Platform admin</Link></h1>
        <span className={`pill ${problems.length ? 'bad' : liveMode() ? 'ok' : 'warn'}`}>{problems.length ? 'Stripe not configured' : liveMode() ? 'Stripe LIVE' : 'Stripe TEST'}</span>
        <span className="sp" />
        <span className="muted small">{user.email}</span>
        <form action="/api/logout" method="post"><button className="btn">Log out</button></form>
      </div>
      {problems.length > 0 && <div className="note warn" style={{ marginBottom: 12 }}>{problems.join(' · ')}</div>}
      {children}
    </div>
  );
}
