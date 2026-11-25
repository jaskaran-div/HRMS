import { NextResponse } from 'next/server';
import { guard, trustedClientIp } from '@/lib/auth';
import { ADMIN_ROLES } from '@/lib/roles';
import { normIp } from '@/lib/checkin';

export const dynamic = 'force-dynamic';

/** The public IP this request came from: Company & Rules → Check-in → "Add the network I'm on" (run it in the office). */
export async function GET() {
  const g = await guard(ADMIN_ROLES);
  if (!g.ok) return g.response;
  const ip = await trustedClientIp();
  return NextResponse.json({ ip: ip ? normIp(ip) : null });
}
