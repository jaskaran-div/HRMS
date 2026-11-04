'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { downloadXlsx, readSheet } from '@/lib/sheet';
import { parseEmployees, type ParsedEmployees } from '@/lib/parse-employees';
import { inrWhole } from '@/lib/format';
import { fmtDate } from '@/lib/dates';
import type { Employee } from '@/lib/types';

const TEXT = ['department', 'designation', 'email', 'phone', 'emergency_name', 'emergency_phone', 'location', 'manager', 'bank_name', 'account_no', 'ifsc', 'pan', 'pf_no'] as const;

export default function ImportPage() {
  const { canEdit, notify } = useApp();
  const [parsed, setParsed] = useState<ParsedEmployees | null>(null);
  const [existing, setExisting] = useState<Map<string, Employee>>(new Map());
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sb = () => supabaseBrowser();
  const loadAll = () => fetchAll<Employee>((a, b) => sb().from('employees').select('*').order('emp_code').range(a, b));

  async function onFile(file?: File) {
    if (!file) return;
    try {
      const p = parseEmployees(await readSheet(file));
      const have = await loadAll();
      setExisting(new Map(have.map(e => [e.emp_code, e])));
      setParsed(p); setFileName(file.name);
    } catch (e) {
      notify(`Could not read that file: ${e instanceof Error ? e.message : e}`, 'err');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function save() {
    if (!parsed) return;
    setBusy(true);
    // Merge: a value in the sheet wins; a blank cell never wipes what is already saved.
    const payload = parsed.employees.map(p => {
      const old = existing.get(p.emp_code);
      const f = p.fields;
      const row: Record<string, unknown> = {
        emp_code: p.emp_code,
        name: f.name ?? old?.name ?? p.emp_code,
        doj: f.doj ?? old?.doj ?? null,
        dob: f.dob ?? old?.dob ?? null,
        monthly_salary: f.monthly_salary ?? old?.monthly_salary ?? 0,
        pf_amount: f.pf_amount ?? old?.pf_amount ?? 0,
        tds_amount: f.tds_amount ?? old?.tds_amount ?? 0,
        extra: { ...(old?.extra ?? {}), ...p.extra },
        archived_at: old?.archived_at ?? null,
      };
      for (const k of TEXT) row[k] = (f as Record<string, string | undefined>)[k] ?? old?.[k] ?? null;
      return row;
    });
    for (let i = 0; i < payload.length; i += 200) {
      const { error } = await sb().from('employees').upsert(payload.slice(i, i + 200), { onConflict: 'emp_code' });
      if (error) { notify(error.message, 'err'); setBusy(false); return; }
    }
    setBusy(false);
    notify(`Imported ${payload.length} employees`);
    setParsed(null);
  }

  async function exportAll() {
    const all = await loadAll();
    downloadXlsx(all.map(e => ({
      'Employee ID': e.emp_code, 'Name': e.name, Department: e.department, Designation: e.designation, Email: e.email, Phone: e.phone,
      'Emergency Contact Name': e.emergency_name, 'Emergency Contact Number': e.emergency_phone,
      'Date of Joining': e.doj, 'Date of Birth': e.dob, Location: e.location, 'Reporting Manager': e.manager,
      'Bank Name': e.bank_name, 'Account No': e.account_no, IFSC: e.ifsc, PAN: e.pan, 'PF / UAN': e.pf_no,
      'Monthly Salary': e.monthly_salary, 'Provident Fund': e.pf_amount, 'Income Tax': e.tds_amount, ...e.extra,
      Status: e.archived_at ? 'Archived' : 'Active',
    })), 'Employees', `employees_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function template() {
    downloadXlsx([{
      'Employee ID': 'ISFTD0001', 'Employee Name': 'Example Person', Department: 'Business Development', Designation: 'Executive',
      Email: 'example@company.com', Phone: '9876500000', 'Emergency Contact Name': 'Relative Name', 'Emergency Contact Number': '9876511111', 'Date of Joining': '2026-01-15', 'Date of Birth': '1995-05-20',
      'Bank Name': 'HDFC Bank', 'Account No': '50100123456789', IFSC: 'HDFC0001234', PAN: 'ABCDE1234F', 'UAN': '100200300400',
      'Monthly Salary': 25000, 'Provident Fund': 0, 'Income Tax': 0,
    }], 'Employees', 'employee_sheet_template.xlsx');
  }

  const fresh = parsed ? parsed.employees.filter(p => !existing.has(p.emp_code)).length : 0;
  const noName = parsed ? parsed.employees.filter(p => !p.fields.name && !existing.get(p.emp_code)).length : 0;
  const noSalary = parsed ? parsed.employees.filter(p => !p.fields.monthly_salary && !existing.get(p.emp_code)?.monthly_salary).length : 0;

  return (
    <>
      <div className="page-h"><h2>Import / Export</h2></div>

      {canEdit ? (
        <div className="card">
          <h3>Upload your employee sheet</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Excel or CSV, one row per employee. Required column: <b>Employee ID</b>. Matched by column name: Employee Name, Department, Designation, Email, Phone, Emergency Contact Name, Emergency Contact Number,
            Date of Joining, Date of Birth, Bank Name, Account No, IFSC, PAN, UAN / PF No, <b>Monthly Salary</b>, Provident Fund, Income Tax.
            Any other column is kept as an extra detail. Re-uploading updates existing employees; blank cells never erase saved data.
          </p>
          <div className="row tight">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => onFile(e.target.files?.[0])} />
            <button className="btn" onClick={template}>Download sample sheet</button>
          </div>
        </div>
      ) : <div className="note">You have view-only access. Ask an editor or admin to import data.</div>}

      {parsed && (
        <div className="card">
          <h3>Check before importing — {fileName}</h3>
          <div className="stats">
            <div className="stat"><b>{parsed.employees.length}</b><small>employees in sheet</small></div>
            <div className="stat"><b>{fresh}</b><small>new</small></div>
            <div className="stat"><b>{parsed.employees.length - fresh}</b><small>will be updated</small></div>
            <div className="stat"><b>{parsed.skipped}</b><small>rows skipped (no ID)</small></div>
          </div>
          {noName > 0 && <div className="note warn" style={{ marginBottom: 10 }}>{noName} new employee(s) have no name in the sheet; their ID will be used as the name until you edit it.</div>}
          {noSalary > 0 && <div className="note warn" style={{ marginBottom: 10 }}>{noSalary} employee(s) have no Monthly Salary. Payslips need it — it can also come from the attendance sheet&apos;s Salary column.</div>}
          {parsed.unmapped.length > 0 && <div className="note" style={{ marginBottom: 10 }}>Extra columns kept as additional details: {parsed.unmapped.join(', ')}</div>}
          {parsed.warnings.length > 0 && <div className="note warn" style={{ marginBottom: 10 }}><ul>{parsed.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          <div className="tbl-wrap" style={{ maxHeight: 340 }}>
            <table>
              <thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Joined</th><th className="n">Salary</th><th /></tr></thead>
              <tbody>
                {parsed.employees.slice(0, 200).map(p => (
                  <tr key={p.emp_code}>
                    <td>{p.emp_code}</td><td>{p.fields.name}</td><td>{p.fields.department}</td><td>{fmtDate(p.fields.doj)}</td>
                    <td className="n">{p.fields.monthly_salary ? inrWhole(p.fields.monthly_salary) : ''}</td>
                    <td>{existing.has(p.emp_code) ? <span className="pill gray">Update</span> : <span className="pill ok">New</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.employees.length > 200 && <p className="muted small">Showing the first 200 rows.</p>}
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" disabled={busy || !parsed.employees.length} onClick={save}>{busy ? 'Importing…' : `Import ${parsed.employees.length} employees`}</button>
            <button className="btn" onClick={() => setParsed(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Export</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Download everything as an Excel file. Handy as a personal backup — the live data is safely stored in the database.</p>
        <button className="btn" onClick={exportAll}>Export all employees to Excel</button>
        <span className="muted small"> · Attendance is uploaded on the <Link href="/attendance">Attendance</Link> page.</span>
      </div>
    </>
  );
}
