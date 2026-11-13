import Link from 'next/link';
import { redirect } from 'next/navigation';
import { webSession } from '@/lib/web-session';
import { orgHasAccess, STATUS_LABEL } from '@/lib/org';

export const dynamic = 'force-dynamic';

/** Members of an organization without paid access (and suspended organizations) land here. */
export default async function LockedPage() {
  const s = await webSession();
  if (orgHasAccess(s.org)) redirect('/');
  const owner = s.profile.role === 'owner';
  return (
    <div className="login-wrap">
      <div className="public-card">
        <h1>{s.org.name} is not active</h1>
        <p className="sub">Status: <b>{STATUS_LABEL[s.org.status]}</b>.</p>
        {s.org.status === 'suspended'
          ? <p className="note bad">This organization has been suspended{s.org.suspended_reason ? `: ${s.org.suspended_reason}` : ''}. Contact support.</p>
          : owner
            ? <p className="note warn">Activate or renew the subscription to continue. <Link href="/billing">Open Billing</Link></p>
            : <p className="note warn">Your organization’s subscription is not active. Ask the owner to activate it on the web; the HR portal and the mobile app open again as soon as payment is confirmed.</p>}
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn" href="/contact-sales">Contact Sales</Link>
          <form action="/api/logout" method="post"><button className="btn">Log out</button></form>
        </div>
      </div>
    </div>
  );
}
