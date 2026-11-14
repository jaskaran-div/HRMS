import { requirePlatformAdmin } from '@/lib/platform';
import { liveMode, stripeConfigProblems } from '@/lib/stripe';
import { platformName } from '@/lib/platform-mail';
import { AdminNav } from './AdminNav';

export const dynamic = 'force-dynamic';

/** Platform super admin panel (the SaaS operator). Not part of any organization; 404 for everyone else. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  const problems = stripeConfigProblems();
  return (
    <div className="solo">
      <div className="solo-top">
        <h1>{platformName()} · Admin</h1>
        <span className={`pill ${problems.length ? 'gray' : liveMode() ? 'ok' : 'warn'}`} title={problems.join(' · ')}>
          {problems.length ? 'Stripe not set up' : liveMode() ? 'Stripe live' : 'Stripe test mode'}
        </span>
        <span className="sp" />
        <span className="muted small">{user.email}</span>
        <a className="btn" href="/">HR portal</a>
        <form action="/api/logout" method="post"><button className="btn">Log out</button></form>
      </div>
      <AdminNav />
      {children}
    </div>
  );
}
