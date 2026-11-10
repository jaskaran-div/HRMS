'use client';

import { ErrorBox } from '@/components/ui';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { initials } from '@/lib/format';
import type { Employee, Profile } from '@/lib/types';

type Emp = Pick<Employee, 'id' | 'emp_code' | 'name' | 'department' | 'designation' | 'team_lead_id'>;

/** Everyone below `id` (to stop someone being put under their own team member). */
function below(id: string, kids: Map<string, Emp[]>): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) if (!out.has(k.id)) { out.add(k.id); stack.push(k.id); }
  return out;
}

export default function TeamsPage() {
  const { canEdit, isAdmin, notify } = useApp();
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkLead, setBulkLead] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [emps, profiles] = await Promise.all([
      fetchAll<Emp>((a, b) => sb.from('employees').select('id, emp_code, name, department, designation, team_lead_id').is('archived_at', null).order('name').range(a, b)),
      // only admins can read other people's logins; for editors this is just their own row
      sb.from('profiles').select('employee_id, role, active'),
    ]);
    return { emps, profiles: (profiles.data ?? []) as Pick<Profile, 'employee_id' | 'role' | 'active'>[] };
  }, []);

  const emps = useMemo(() => data?.emps ?? [], [data]);
  const byId = useMemo(() => new Map(emps.map(e => [e.id, e])), [emps]);
  const kids = useMemo(() => {
    const m = new Map<string, Emp[]>();
    for (const e of emps) if (e.team_lead_id && byId.has(e.team_lead_id)) m.set(e.team_lead_id, [...(m.get(e.team_lead_id) ?? []), e]);
    return m;
  }, [emps, byId]);
  const roleOf = useMemo(() => new Map((data?.profiles ?? []).filter(p => p.employee_id).map(p => [p.employee_id!, p.role])), [data]);
  const depts = useMemo(() => [...new Set(emps.map(e => e.department).filter(Boolean) as string[])].sort(), [emps]);
  const list = emps.filter(e => (!dept || e.department === dept) &&
    (!q.trim() || [e.name, e.emp_code, e.designation].some(x => (x ?? '').toLowerCase().includes(q.trim().toLowerCase()))));
  // leaders: anyone with a team, plus everyone in the chosen department (so a new leader can be picked)
  const leaderOptions = emps;

  async function assign(ids: string[], lead: string | null) {
    const bad = lead ? ids.filter(id => id === lead || below(id, kids).has(lead)) : [];
    if (bad.length) { notify(`${bad.map(id => byId.get(id)?.name).join(', ')} cannot report to someone in their own team.`, 'err'); return; }
    setBusy(true);
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabaseBrowser().from('employees').update({ team_lead_id: lead }).in('id', ids.slice(i, i + 100));
      if (error) { notify(error.message, 'err'); setBusy(false); return; }
    }
    setBusy(false);
    const l = lead ? byId.get(lead) : null;
    notify(lead ? `${ids.length} employee(s) now report to ${l?.name}` : `Team leader removed for ${ids.length} employee(s)`);
    if (lead && isAdmin && roleOf.get(lead) !== 'team_lead' && roleOf.get(lead) !== 'admin' && roleOf.get(lead) !== 'editor')
      notify(`${l?.name} needs a "Team leader" login (User Access) to see their team.`, 'err');
    setPicked(new Set());
    reload();
  }

  const allShown = list.length > 0 && list.every(e => picked.has(e.id));
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const roots = emps.filter(e => kids.has(e.id) && !(e.team_lead_id && byId.has(e.team_lead_id)))
    .filter(e => !dept || e.department === dept || [...below(e.id, kids)].some(id => byId.get(id)?.department === dept));
  const tree = (e: Emp, depth: number, seen: Set<string>): React.ReactNode => {
    if (seen.has(e.id)) return null;
    const next = new Set(seen).add(e.id);
    const team = kids.get(e.id) ?? [];
    return (
      <div key={e.id} style={{ marginLeft: depth ? 22 : 0, borderLeft: depth ? '2px solid var(--line)' : undefined, paddingLeft: depth ? 10 : 0 }}>
        <div className="who-c" style={{ padding: '5px 0' }}>
          <div className="av">{initials(e.name)}</div>
          <div>
            <Link href={`/employees/${encodeURIComponent(e.emp_code)}`}><b>{e.name}</b></Link>
            <span className="muted small"> · {e.designation || e.emp_code}{e.department ? ` · ${e.department}` : ''}</span>
            {team.length > 0 && <> <span className="pill gray">{team.length} direct</span></>}
            {team.length > 0 && isAdmin && roleOf.get(e.id) !== 'team_lead' && <> <span className="pill warn">no team leader login</span></>}
          </div>
        </div>
        {team.map(k => tree(k, depth + 1, next))}
      </div>
    );
  };

  return (
    <>
      <div className="page-h">
        <span className="muted">{loading ? 'Loading…' : `${emps.length} active employees`}</span>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <div className="note" style={{ marginBottom: 16 }}>
        Pick a department, then choose who each person reports to. A team leader sees everyone below them — their team, and their team&apos;s teams —
        with profile, attendance, payslips and leave (not bank, PAN or salary details). The team leader also needs a <b>Team leader</b> login
        under <Link href="/users">User Access</Link>.
      </div>

      <div className="two">
        <div className="card">
          <div className="tools">
            <select value={dept} onChange={e => { setDept(e.target.value); setPicked(new Set()); }}>
              <option value="">All departments</option>
              {depts.map(d => <option key={d}>{d}</option>)}
            </select>
            <input className="field grow" placeholder="Filter by name, ID…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {canEdit && picked.size > 0 && (
            <div className="note" style={{ marginBottom: 12 }}>
              <div className="row" style={{ marginBottom: 0 }}>
                <b>{picked.size} selected</b>
                <select value={bulkLead} onChange={e => setBulkLead(e.target.value)}>
                  <option value="">— no team leader —</option>
                  {leaderOptions.map(l => <option key={l.id} value={l.id}>{l.name} ({l.emp_code})</option>)}
                </select>
                <button className="btn primary" disabled={busy} onClick={() => assign([...picked], bulkLead || null)}>{busy ? 'Saving…' : 'Set team leader'}</button>
                <button className="btn" onClick={() => setPicked(new Set())}>Clear</button>
              </div>
            </div>
          )}
          <div className="tbl-wrap">
            <table>
              <thead><tr>
                {canEdit && <th style={{ width: 28 }}><input type="checkbox" checked={allShown} aria-label="Select all shown"
                  onChange={() => setPicked(allShown ? new Set() : new Set(list.map(e => e.id)))} /></th>}
                <th>Employee</th><th>Department</th><th>Reports to</th>
              </tr></thead>
              <tbody>
                {list.map(e => {
                  const blocked = below(e.id, kids);
                  return (
                    <tr key={e.id}>
                      {canEdit && <td><input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.name}`} /></td>}
                      <td><b>{e.name}</b><div className="muted small">{e.emp_code}{e.designation ? ` · ${e.designation}` : ''}</div></td>
                      <td>{e.department}</td>
                      <td>
                        {canEdit ? (
                          <select value={e.team_lead_id ?? ''} disabled={busy} onChange={ev => assign([e.id], ev.target.value || null)} style={{ maxWidth: 230 }}>
                            <option value="">— none —</option>
                            {leaderOptions.filter(l => l.id !== e.id && !blocked.has(l.id)).map(l => <option key={l.id} value={l.id}>{l.name} ({l.emp_code})</option>)}
                          </select>
                        ) : (e.team_lead_id ? byId.get(e.team_lead_id)?.name : '—')}
                      </td>
                    </tr>
                  );
                })}
                {!list.length && !loading && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 26 }}>No employees.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>Hierarchy{dept ? ` · ${dept}` : ''}</h3>
          {roots.map(r => tree(r, 0, new Set()))}
          {!roots.length && <p className="muted">No teams yet. Choose “Reports to” for some employees.</p>}
        </div>
      </div>
    </>
  );
}
