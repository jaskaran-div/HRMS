import { LoginForm } from './LoginForm';
import { AppDownloadFab } from '@/components/AppDownloadFab';
import { androidApp } from '@/lib/mobile-app';
import { loginBrand } from '@/lib/brand';

export const dynamic = 'force-dynamic';

/**
 * One login page for every organization. It shows the name and logo of LOGIN_BRAND_ORG (an organization's slug),
 * by default the first organization (Derivion), exactly as before. LOGIN_BRAND_ORG=none shows the platform name.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string; invited?: string }> }) {
  const sp = await searchParams;
  const brand = await loginBrand();
  const notice = sp.verified ? 'Email verified. Log in to continue.' : sp.invited ? 'Your account is ready. Log in with your email and new password.' : null;
  const app = await androidApp();
  return <>
    <LoginForm company={brand.name} logo={brand.logo} notice={notice} />
    {app.available && <AppDownloadFab store={app.kind === 'store'} />}
  </>;
}
