// SERVER ONLY. In-app notifications (the mobile app's inbox) + push to the phones the person is signed in on.
import { supabaseAdmin } from './supabase/admin';

export interface Note {
  kind: string;
  title: string;
  body: string;
  /** Passed to the app; `screen` = the app route opened when the notification is tapped. */
  data?: Record<string, string>;
}

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

/**
 * Saves a notification for each login and pushes it to their phones. Best effort: never throws, so a push
 * problem can never break saving a leave request or a payslip.
 */
export async function notifyUsers(userIds: (string | null | undefined)[], n: Note): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  try {
    const admin = supabaseAdmin();
    await admin.from('notifications').insert(ids.map(user_id => ({ user_id, kind: n.kind, title: n.title, body: n.body, data: n.data ?? {} })));
    const { data: tokens } = await admin.from('push_tokens').select('token').in('user_id', ids);
    const list = (tokens ?? []).map(t => t.token as string);
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk.map(to => ({ to, title: n.title, body: n.body, data: n.data ?? {}, sound: 'default', channelId: 'default' }))),
      });
      const j = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
      // phones that uninstalled the app / logged out: forget their token
      const dead = (j?.data ?? []).map((t, k) => (t.details?.error === 'DeviceNotRegistered' ? chunk[k] : null)).filter(Boolean) as string[];
      if (dead.length) await admin.from('push_tokens').delete().in('token', dead);
    }
  } catch { /* best effort */ }
}

/** Login ids linked to these employee records (active logins only). */
export async function usersOfEmployees(employeeIds: (string | null | undefined)[]): Promise<string[]> {
  const ids = employeeIds.filter((x): x is string => !!x);
  if (!ids.length) return [];
  const { data } = await supabaseAdmin().from('profiles').select('id').in('employee_id', ids).eq('active', true);
  return (data ?? []).map(p => p.id as string);
}

/** HR staff who can decide leave (admins and editors). */
export async function hrUsers(): Promise<string[]> {
  const { data } = await supabaseAdmin().from('profiles').select('id').in('role', ['admin', 'editor']).eq('active', true);
  return (data ?? []).map(p => p.id as string);
}

/** The team leader login above this employee, if any. */
export async function leadUserOf(employeeId: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data: emp } = await admin.from('employees').select('team_lead_id').eq('id', employeeId).maybeSingle();
  if (!emp?.team_lead_id) return null;
  const { data: p } = await admin.from('profiles').select('id').eq('employee_id', emp.team_lead_id).eq('role', 'team_lead').eq('active', true).maybeSingle();
  return (p?.id as string | undefined) ?? null;
}
