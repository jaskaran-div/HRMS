import { redirect } from 'next/navigation';
import { requireAccess, webSession } from '@/lib/web-session';
import { orgSettings } from '@/lib/tenant';
import { OnboardingForm } from './OnboardingForm';

export const dynamic = 'force-dynamic';

/** Web only: the owner sets the organization up once, after the first payment is confirmed. */
export default async function OnboardingPage() {
  const s = await webSession();
  await requireAccess(s);
  if (s.profile.role !== 'owner') redirect('/');
  const st = await orgSettings(s.org.id);
  return (
    <div className="login-wrap">
      <div className="public-card">
        <h1>Set up {s.org.name}</h1>
        <p className="sub">Payment confirmed — welcome! A few details and you are ready to invite your HR team and employees. You can change all of this later under Company &amp; Rules.</p>
        <OnboardingForm initial={{
          company_name: st?.company_name ?? s.org.name, company_address: st?.company_address ?? '', hr_email: st?.hr_email ?? s.org.owner_email ?? '',
          email_domains: st?.email_domains ?? '', paid_leave_per_month: String(st?.paid_leave_per_month ?? 1), short_leave_per_month: String(st?.short_leave_per_month ?? 1),
          office_lat: st?.office_lat?.toString() ?? '', office_lng: st?.office_lng?.toString() ?? '', office_radius_m: String(st?.office_radius_m ?? 100),
        }} />
      </div>
    </div>
  );
}
