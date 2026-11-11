import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { appUrl, emailTeamAssigned } from '@/lib/notify-mail';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notifyUsers, usersOfEmployees } from '@/lib/push';
import { monthLabel } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/**
 * Notifications for changes HR saves straight from the browser.
 * Body: { kind: 'team', employee_ids: string[], lead_id: string | null } — sent after "Reports to" is saved.
 * The server only emails what is really stored (it re-reads each employee's team leader).
 */
export async function POST(req: Request) {
  const g = await guard(['admin', 'editor']);
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { kind?: string; employee_ids?: unknown; lead_id?: unknown; month?: unknown };
  const ids = Array.isArray(b.employee_ids) ? b.employee_ids.filter((x): x is string => typeof x === 'string') : [];
  if (b.kind === 'payslips') {
    // push to the mobile app: only employees who really have a payslip for that month
    const month = typeof b.month === 'string' && /^\d{4}-\d{2}-01$/.test(b.month) ? b.month : null;
    if (!month || !ids.length) return NextResponse.json({ sent: 0 });
    const { data } = await supabaseAdmin().from('payslips').select('employee_id').eq('month', month).in('employee_id', ids);
    const users = await usersOfEmployees((data ?? []).map(r => r.employee_id as string));
    await notifyUsers(users, { kind: 'payslip', title: 'Your payslip is ready', body: `Payslip for ${monthLabel(month)} is now available.`, data: { screen: '/payslips', month } });
    return NextResponse.json({ sent: users.length });
  }
  if (b.kind !== 'team') return NextResponse.json({ error: 'Unknown notification.' }, { status: 400 });
  if (!ids.length) return NextResponse.json({ sent: 0 });
  const lead = typeof b.lead_id === 'string' && b.lead_id ? b.lead_id : null;
  return NextResponse.json(await emailTeamAssigned(ids, lead, appUrl(req)));
}
