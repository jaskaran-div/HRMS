'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppContext';
import { FormModal } from '@/components/Modal';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { initials, inrWhole } from '@/lib/format';
import { fmtDate } from '@/lib/dates';
import { EMPLOYEE_FIELDS, employeeToValues, valuesToEmployee } from '@/lib/employee-form';
import type { Employee } from '@/lib/types';

export default function EmployeesPage() {
  const { canEdit, notify } = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);

  const { data: all = [], loading, error, reload } = useLoad(() => {
    const sb = supabaseBrowser();
    return fetchAll<Employee>((a, b) => sb.from('employees').select('*').order('emp_code').range(a, b));
  }, []);

  const depts = useMemo(() => [...new Set(all.map(e => e.department).filter(Boolean) as string[])].sort(), [all]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter(e =>
      (archived ? !!e.archived_at : !e.archived_at) &&
      (!dept || e.department === dept) &&
      (!t || [e.emp_code, e.name, e.designation, e.department].some(x => (x ?? '').toLowerCase().includes(t))));
  }, [all, q, dept, archived]);

  return (
    <>
      <div className="page-h">
        <h2>{archived ? 'Archived employees' : 'All employees'}</h2>
        <span className="muted">{loading ? 'Loading…' : `${list.length} shown`}</span>
        <span className="sp" />
        {canEdit && <button className="btn primary" onClick={() => setAdding(true)}>+ Add employee</button>}
      </div>
      {error && <p className="err">{error}</p>}

      <div className="card">
        <div className="tools">
          <input className="field grow" placeholder="Filter by name, ID, designation…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts.map(d => <option key={d}>{d}</option>)}
          </select>
          <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived
          </label>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Designation</th><th>Joined</th><th className="n">Monthly salary</th></tr></thead>
            <tbody>
              {list.map(e => (
                <tr key={e.id} className="click" onClick={() => router.push(`/employees/${encodeURIComponent(e.emp_code)}`)}>
                  <td><div className="who-c"><div className="av">{initials(e.name)}</div><b>{e.name}</b></div></td>
                  <td>{e.emp_code}</td><td>{e.department}</td><td>{e.designation}</td><td>{fmtDate(e.doj)}</td>
                  <td className="n">{e.monthly_salary ? inrWhole(e.monthly_salary) : <span className="pill warn">Not set</span>}</td>
                </tr>
              ))}
              {!list.length && !loading && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                  {all.length ? 'No employees match.' : 'No employees yet — use Import / Export to upload your employee sheet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <FormModal
          title="Add employee" fields={EMPLOYEE_FIELDS} initial={employeeToValues()} onClose={() => setAdding(false)}
          onSave={async v => {
            const row = valuesToEmployee(v);
            const { error } = await supabaseBrowser().from('employees').insert(row);
            if (error) return error.code === '23505' ? `Employee ID ${row.emp_code} already exists.` : error.message;
            notify(`${row.name} added`);
            reload();
          }}
        />
      )}
    </>
  );
}
