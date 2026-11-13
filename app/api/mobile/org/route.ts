import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { summarize } from '@/lib/org';

export const dynamic = 'force-dynamic';

/**
 * The mobile app's first call after login: the login's organization, whether it may be used, and its features.
 * Works for locked organizations too, so the app can explain why it is locked. No billing data, no payment actions:
 * activation happens on the web only.
 */
export async function GET() {
  const g = await guard(undefined, { allowLocked: true });
  if (!g.ok) return g.response;
  const s = summarize(g.org);
  return NextResponse.json({
    organization: { id: s.id, name: s.name, status: s.status, access: s.access, features: s.features, pastDue: s.pastDue },
    role: g.profile.role,
  });
}
