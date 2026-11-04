'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { FormModal } from '@/components/Modal';
import { AttendanceModal } from '@/components/AttendanceModal';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useLoad } from '@/lib/use-load';
import { fmtDate, monthLabel } from '@/lib/dates';
import { initials, inr } from '@/lib/format';
import { payFor, rulesFrom } from '@/lib/payroll';
import { buildExit, carryInto, leavingDate } from '@/lib/exit';
import { downloadRelieving, openRelieving } from '@/lib/relieving-pdf';
import { EMPLOYEE_FIELDS, employeeToValues, valuesToEmployee } from '@/lib/employee-form';
import { downloadPayslips, openPayslips, printPayslips, payslipFilename } from '@/lib/payslip-pdf';
import { buildPayslip } from '@/lib/payroll';
import { todayISO } from '@/lib/dates';
import type { Attendance, Employee, ExitRecord, PayslipRow } from '@/lib/types';

type Tab = 'profile' | 'pay' | 'payslips';

const kv = (label: string, value: string | null | undefined) =>
  value ? <div className="kv"><small>{label}</small><span>{value}</span></div> : null;

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const code = decodeURIComponent(id).toUpperCase();
  const { canEdit, isAdmin, settings, notify } = useApp();
  const [tab, setTab] = useState<Tab>('profile');
  const [editing, setEditing] = useState(false);
  const [attModal, setAttModal] = useState<{ month: string | null; existing?: Attendance } | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [relievedOn, setRelievedOn] = useState('');
  const [exitMonths, setExitMonths] = useState<3 | 6>(3);
  const [busyExit, setBusyExit] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const { data: emp, error } = await sb.from('employees').select('*').eq('emp_code', code).maybeSingle();
    if (error) throw new Error(error.message);
    if (!emp) return null;
    const [att, slips, exit] = await Promise.all([
      sb.from('attendance').select('*').eq('employee_id', emp.id).order('month', { ascending: false }),
      sb.from('payslips').select('*').eq('employee_id', emp.id).order('month', { ascending: false }),
      sb.from('exit_records').select('*').eq('employee_id', emp.id).maybeSingle(),
    ]);
    if (att.error) throw new Error(att.error.message);
    return {
      emp: emp as Employee, att: (att.data ?? []) as Attendance[], slips: (slips.data ?? []) as PayslipRow[],
      exit: (exit.data ?? null) as ExitRecord | null,
    };
  }, [code]);

  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error) return <p className="err">{error}</p>;
  if (!data) {
    return (
      <div className="card empty"><div className="big">🔍</div><h2>No employee with ID {code}</h2>
        <p className="muted">Check the ID, or browse <Link href="/employees">all employees</Link>.</p></div>
    );
  }
  const { emp, att, slips, exit } = data;
  const rules = rulesFrom(settings);
  const company = { name: settings.company_name, address: settings.company_address, logo: settings.logo, footer: settings.footer_note };

  const carryOf = (a: Attendance) => carryInto(emp, att, slips, a, false, rules);
  const leaving = leavingDate(emp);
  const exitDate = relievedOn || leaving || '';

  async function makeInactive() {
    if (!exitDate) { notify('Enter the last working day first.', 'err'); return; }
    if (!confirm(`Mark ${emp.name} inactive from ${fmtDate(exitDate)}? They leave the lists and payroll; the relieving letter and last ${exitMonths} months of payslips are generated and kept.`)) return;
    setBusyExit(true);
    const { letter, payslips } = buildExit(emp, att, slips, rules, exitDate, exitMonths, todayISO());
    const sb = supabaseBrowser();
    const rec = await sb.from('exit_records').upsert(
      { employee_id: emp.id, relieved_on: exitDate, payslip_months: exitMonths, letter, payslips }, { onConflict: 'employee_id' });
    if (rec.error) { notify(rec.error.message, 'err'); setBusyExit(false); return; }
    const { error } = await sb.from('employees').update({ archived_at: new Date().toISOString() }).eq('id', emp.id);
    setBusyExit(false);
    if (error) { notify(error.message, 'err'); return; }
    notify(`${emp.name} is now inactive · relieving letter + ${payslips.length} payslip${payslips.length === 1 ? '' : 's'} saved`);
    setExitOpen(false);
    reload();
  }

  async function makeActive() {
    if (!confirm(`Mark ${emp.name} active again? The saved relieving letter and exit payslips will be removed.`)) return;
    const sb = supabaseBrowser();
    const { error } = await sb.from('employees').update({ archived_at: null }).eq('id', emp.id);
    if (error) { notify(error.message, 'err'); return; }
    await sb.from('exit_records').delete().eq('employee_id', emp.id);
    notify('Employee is active again');
    reload();
  }

  async function deleteMonth(a: Attendance) {
    if (!confirm(`Delete the ${monthLabel(a.month)} attendance record for ${emp.name}?`)) return;
    const { error } = await supabaseBrowser().from('attendance').delete().eq('id', a.id);
    if (error) notify(error.message, 'err'); else { notify('Deleted'); reload(); }
  }

  return (
    <>
      <div className="page-h"><Link href="/employees" className="btn">← All employees</Link></div>
      <div className="card">
        <div className="hero">
          <div className="av">{initials(emp.name)}</div>
          <div>
            <h2>{emp.name}</h2>
            <div className="chips">
              <span className="pill gray">{emp.emp_code}</span>
              {emp.designation && <span className="pill gray">{emp.designation}</span>}
              {emp.department && <span className="pill gray">{emp.department}</span>}
              <span className={`pill ${emp.archived_at ? 'bad' : 'ok'}`}>{emp.archived_at ? 'Inactive' : 'Active'}</span>
            </div>
          </div>
        </div>

        <div className="tabs">
          {([['profile', 'Profile'], ['pay', 'Attendance & salary'], ['payslips', `Payslips (${slips.length})`]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          {tab === 'profile' && (
            <>
              <div className="grid">
                {kv('Employee ID', emp.emp_code)}{kv('Department', emp.department)}{kv('Designation', emp.designation)}
                {kv('Date of joining', fmtDate(emp.doj))}{kv('Date of birth', fmtDate(emp.dob))}{kv('Location', emp.location)}
                {kv('Reporting manager', emp.manager)}{kv('Email', emp.email)}{kv('Phone', emp.phone)}{kv('Emergency contact', emp.emergency_name)}{kv('Emergency number', emp.emergency_phone)}
                {kv('PAN', emp.pan)}{kv('PF / UAN', emp.pf_no)}{kv('Bank', emp.bank_name)}
                {kv('Account number', emp.account_no)}{kv('IFSC', emp.ifsc)}
                {kv('Monthly salary', emp.monthly_salary ? inr(emp.monthly_salary) : 'Not set')}
                {kv('Provident Fund / month', emp.pf_amount ? inr(emp.pf_amount) : '')}
                {kv('Income tax / month', emp.tds_amount ? inr(emp.tds_amount) : '')}
                {Object.entries(emp.extra ?? {}).map(([k, v]) => kv(k, v))}
              </div>
              {canEdit && (
                <div className="row" style={{ marginTop: 22 }}>
                  <button className="btn primary" onClick={() => setEditing(true)}>✏️ Edit details</button>
                  {emp.archived_at
                    ? <button className="btn" onClick={makeActive}>Mark active</button>
                    : <button className="btn danger" onClick={() => setExitOpen(o => !o)}>Mark inactive…</button>}
                </div>
              )}
              {canEdit && !emp.archived_at && exitOpen && (
                <div className="note" style={{ marginTop: 14 }}>
                  <div className="row">
                    <label className="small">Last working day <input type="date" value={exitDate} onChange={e => setRelievedOn(e.target.value)} /></label>
                    <label className="small">Save payslips of the last{' '}
                      <select value={exitMonths} onChange={e => setExitMonths(+e.target.value as 3 | 6)}><option value={3}>3 months</option><option value={6}>6 months</option></select>
                    </label>
                    <button className="btn danger" disabled={busyExit || !exitDate} onClick={makeInactive}>{busyExit ? 'Saving…' : 'Make inactive & generate documents'}</button>
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>Generates the relieving letter and the payslips (from saved attendance) and keeps them on this page. Payroll skips inactive employees.</p>
                </div>
              )}
              {emp.archived_at && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h3 style={{ marginTop: 0 }}>Exit documents</h3>
                  {exit ? (
                    <>
                      <p className="muted small" style={{ marginTop: 0 }}>Relieved on {fmtDate(exit.relieved_on)} · {exit.payslips.length} payslip(s) from the last {exit.payslip_months} months.</p>
                      <div className="row">
                        <button className="btn" onClick={() => openRelieving(exit.letter, company)}>View relieving letter</button>
                        <button className="btn primary" onClick={() => downloadRelieving(exit.letter, company)}>Download relieving letter</button>
                        {exit.payslips.length > 0 && (
                          <button className="btn primary" onClick={() => downloadPayslips(exit.payslips, company, `Payslips_${exit.letter.employee.code}_last_${exit.payslip_months}_months.pdf`)}>Download payslips (PDF)</button>
                        )}
                      </div>
                    </>
                  ) : <p className="muted small" style={{ margin: 0 }}>No exit documents were saved for this employee.</p>}
                </div>
              )}
            </>
          )}

          {tab === 'pay' && (
            <>
              {canEdit && <div className="row"><button className="btn primary" onClick={() => setAttModal({ month: null })}>+ Add / correct a month</button></div>}
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Month</th><th className="n">Present</th><th className="n">Half</th><th className="n">Absent</th><th className="n">Leave</th><th className="n">Week off</th>
                    <th className="n">Paid days</th><th className="n">LOP</th><th className="n">Gross</th><th className="n">Net pay</th><th /></tr></thead>
                  <tbody>
                    {att.map(a => {
                      const cf = carryOf(a);
                      const p = payFor(emp, a, rules, cf);
                      return (
                        <tr key={a.id}>
                          <td><b>{monthLabel(a.month)}</b></td>
                          <td className="n">{a.present_days}</td><td className="n">{a.half_days}</td><td className="n">{a.absent_days}</td>
                          <td className="n">{Number(a.leave_days) + p.leaveConverted}</td><td className="n">{a.weekoff_days}</td>
                          <td className="n">{p.paidDays}</td><td className="n">{p.lopDays}</td>
                          <td className="n">{inr(p.gross)}</td><td className="n"><b>{inr(p.net)}</b></td>
                          <td style={{ textAlign: 'right' }}>
                            {(() => { const d = buildPayslip(emp, a, rules, todayISO(), cf); return (<><button className="btn sm" onClick={() => openPayslips([d], company)}>Payslip</button>{' '}<button className="btn sm" onClick={() => printPayslips([d], company)}>Print</button>{' '}<button className="btn sm" onClick={() => downloadPayslips([d], company, payslipFilename(d))}>PDF</button>{' '}</>); })()}
                            {canEdit && <button className="btn sm" onClick={() => setAttModal({ month: a.month, existing: a })}>Edit</button>}{' '}
                            {isAdmin && <button className="btn sm danger" onClick={() => deleteMonth(a)}>Delete</button>}
                          </td>
                        </tr>
                      );
                    })}
                    {!att.length && <tr><td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 26 }}>
                      No attendance yet. Upload a month on the Attendance page, or add one here.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="muted small">Leave = paid leave in the sheet plus the monthly paid leave ({Number(settings.paid_leave_per_month)} day) given to the first absence.</p>
            </>
          )}

          {tab === 'payslips' && (
            <>
              <p className="muted small" style={{ marginTop: 0 }}>Payslips are kept for the latest 2 months only; older ones are removed automatically. Generate them from Payroll &amp; Payslips.</p>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Month</th><th>Pay date</th><th className="n">Net pay</th><th /></tr></thead>
                  <tbody>
                    {slips.map(s => (
                      <tr key={s.id}>
                        <td><b>{monthLabel(s.month)}</b></td><td>{fmtDate(s.pay_date)}</td><td className="n">{inr(s.net_pay)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn sm" onClick={() => openPayslips([s.data], company)}>View</button>{' '}
                          <button className="btn sm" onClick={() => printPayslips([s.data], company)}>Print</button>{' '}
                          <button className="btn sm primary" onClick={() => downloadPayslips([s.data], company, payslipFilename(s.data))}>Download PDF</button>
                        </td>
                      </tr>
                    ))}
                    {!slips.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 26 }}>No payslips generated yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {editing && (
        <FormModal
          title={`Edit — ${emp.name}`}
          fields={[
            ...EMPLOYEE_FIELDS.map(f => (f.key === 'emp_code' ? { ...f, readOnly: true } : f)),
            ...Object.keys(emp.extra ?? {}).map(k => ({ key: 'x:' + k, label: k })),
          ]}
          initial={employeeToValues(emp)} onClose={() => setEditing(false)}
          onSave={async v => {
            const row = valuesToEmployee({ ...v, emp_code: emp.emp_code });
            const { error } = await supabaseBrowser().from('employees').update(row).eq('id', emp.id);
            if (error) return error.message;
            notify('Saved');
            reload();
          }}
        />
      )}
      {attModal && (
        <AttendanceModal emp={emp} month={attModal.month} existing={attModal.existing}
          onClose={() => setAttModal(null)} onSaved={reload} />
      )}
    </>
  );
}
