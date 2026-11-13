import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { summarize } from '@/lib/org';

export const dynamic = 'force-dynamic';

/** The organization's status (polled by the Billing page after checkout until the webhook has activated it). */
export async function GET() {
  const g = await guard(undefined, { allowLocked: true });
  if (!g.ok) return g.response;
  return NextResponse.json({ org: summarize(g.org) });
}
