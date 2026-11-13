import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { ResendVerification } from './ResendVerification';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'This verification link is not valid.',
  used: 'This verification link was already used. If your email is verified, just log in.',
  expired: 'This verification link has expired. Send yourself a new one below.',
  failed: 'We could not verify your email right now. Please try the link again.',
};

/** Shown to an owner whose email is not verified yet, and when a verification link fails. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  return (
    <div className="login-wrap">
      <div className="public-card">
        <h1>Verify your email</h1>
        {error && <p className="note bad">{ERRORS[error] ?? ERRORS.invalid}</p>}
        <p className="sub">Open the link we emailed {user?.email ? <b>{user.email}</b> : 'you'} to continue. It expires after 24 hours.</p>
        <ResendVerification email={user?.email ?? ''} />
        <p className="foot">
          <Link href="/login">Log in</Link>
          {user && <> · <form action="/api/logout" method="post" style={{ display: 'inline' }}><button className="btn sm">Log out</button></form></>}
        </p>
      </div>
    </div>
  );
}
