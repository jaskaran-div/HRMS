import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { appUrl, emailTeamAssigned } from '@/lib/notify-mail';

export const dynamic = 'force-dynamic';

/**
 * Notifications for changes HR saves straight from the browser.
 * Body: { kind: 'team', employee_ids: string[], lead_id: string | null } — sent after "Reports to" is saved.
 * The server only emails what is really stored (it re-reads each employee's team leader).
 */
export async function POST(req: Request) {
  const g = await guard(['admin', 'editor']);
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { kind?: string; employee_ids?: unknown; lead_id?: unknown };
  if (b.kind !== 'team') return NextResponse.json({ error: 'Unknown notification.' }, { status: 400 });
  const ids = Array.isArray(b.employee_ids) ? b.employee_ids.filter((x): x is string => typeof x === 'string') : [];
  if (!ids.length) return NextResponse.json({ sent: 0 });
  const lead = typeof b.lead_id === 'string' && b.lead_id ? b.lead_id : null;
  return NextResponse.json(await emailTeamAssigned(ids, lead, appUrl(req)));
}
