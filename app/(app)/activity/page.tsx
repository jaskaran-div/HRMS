'use client';

import { ErrorBox } from '@/components/ui';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { monthLabel } from '@/lib/dates';
import type { Employee } from '@/lib/types';

interface Entry {
  id: number; at: string; username: string | null; table_name: string; op: string; row_id: string | null;
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null;
}

const LABEL: Record<string, string> = {
  INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Deleted', CREATE_USER: 'Created login', RESET_PASSWORD: 'Reset password',
  DEACTIVATE_USER: 'Disabled login', ACTIVATE_USER: 'Enabled login', SET_ROLE: 'Changed role', PASSWORD_CHANGED: 'Changed own password',
};
const NOISE = new Set(['updated_at', 'created_at', 'id', 'daily']);

export default function ActivityPage() {
  const { isAdmin } = useApp();
  const { data, loading, error } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [{ data: log, error }, emps] = await Promise.all([
      sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300),
      fetchAll<Employee>((a, b) => sb.from('employees').select('id, emp_code, name').range(a, b) as never),
    ]);
    if (error) throw new Error(error.message);
    return { log: (log ?? []) as Entry[], emps: new Map(emps.map(e => [e.id, e])) };
  }, []);

  if (!isAdmin) return <div className="note">Only admins can see the activity log.</div>;

  function describe(e: Entry): string {
    const d = (e.new_data ?? e.old_data ?? {}) as Record<string, unknown>;
    let who = '';
    if (e.table_name === 'employees') who = `${d.name ?? ''} (${d.emp_code ?? ''})`;
    else if (e.table_name === 'attendance') {
      const emp = data?.emps.get(String(d.employee_id));
      who = `${emp ? emp.name : 'employee'} — ${d.month ? monthLabel(String(d.month)) : ''}`;
    } else if (e.table_name === 'settings') who = 'company / pay rules';
    else if (e.table_name === 'users') who = String(d.username ?? '');
    let changes = '';
    if (e.op === 'UPDATE' && e.old_data && e.new_data) {
      const keys = Object.keys(e.new_data).filter(k => !NOISE.has(k) && JSON.stringify(e.new_data![k]) !== JSON.stringify(e.old_data![k]));
      changes = keys.slice(0, 5).map(k => `${k}: ${fmt(e.old_data![k])} → ${fmt(e.new_data![k])}`).join('; ') + (keys.length > 5 ? '…' : '');
    }
    return [who, changes].filter(Boolean).join(' · ');
  }
  const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '∅' : typeof v === 'object' ? '{…}' : String(v));

  return (
    <>
      <div className="page-h"><h2>Activity log</h2><span className="muted">Last 300 changes — who did what, and when</span></div>
      {error && <ErrorBox message={error} />}
      <div className="card">
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Where</th><th>Details</th></tr></thead>
            <tbody>
              {(data?.log ?? []).map(e => (
                <tr key={e.id}>
                  <td>{new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{e.username ?? <span className="muted">system</span>}</td>
                  <td>{LABEL[e.op] ?? e.op}</td>
                  <td>{e.table_name}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 520 }}>{describe(e)}</td>
                </tr>
              ))}
              {!data?.log.length && !loading && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 26 }}>Nothing yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
