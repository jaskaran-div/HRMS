'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { buildPayslip, payFor, rulesFrom } from '@/lib/payroll';
import { currentYM, fmtDate, monthLabel, monthStart, shiftMonth, todayISO } from '@/lib/dates';
import { inr, inrWhole } from '@/lib/format';
import { downloadPayslips, openPayslips, printPayslips, payslipFilename } from '@/lib/payslip-pdf';
import type { PayslipData } from '@/lib/types';
import type { Attendance, Employee, PayslipRow } from '@/lib/types';

const KEEP_MONTHS = 2;

export default function PayrollPage() {
  const { canEdit, settings, notify } = useApp();
  const rules = rulesFrom(settings);
  const company = { name: settings.company_name, address: settings.company_address, logo: settings.logo, footer: settings.footer_note };
  const [ym, setYm] = useState(() => shiftMonth(`${currentYM()}-01`, -1).slice(0, 7));
  const month = monthStart(ym);
  const [payDate, setPayDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [emps, att, slips, months] = await Promise.all([
      fetchAll<Employee>((a, b) => sb.from('employees').select('*').is('archived_at', null).order('emp_code').range(a, b)),
      fetchAll<Attendance>((a, b) => sb.from('attendance').select('*').eq('month', month).range(a, b)),
      fetchAll<PayslipRow>((a, b) => sb.from('payslips').select('*').eq('month', month).range(a, b)),
      fetchAll<{ month: string }>((a, b) => sb.from('payslips').select('month').range(a, b)),
    ]);
    return { emps, att, slips, months: [...new Set(months.map(x => x.month))] };
  }, [month]);

  const rows = useMemo(() => {
    const attBy = new Map((data?.att ?? []).map(a => [a.employee_id, a]));
    const slipBy = new Map((data?.slips ?? []).map(s => [s.employee_id, s]));
    return (data?.emps ?? []).map(emp => {
      const att = attBy.get(emp.id);
      const pay = att ? payFor(emp, att, rules) : null;
      const slip = slipBy.get(emp.id);
      const hasSalary = !!att && (Number(att.salary) > 0 || Number(emp.monthly_salary) > 0);
      let status: 'noatt' | 'nosalary' | 'new' | 'ok' | 'stale' = 'new';
      if (!att) status = 'noatt';
      else if (!hasSalary) status = 'nosalary';
      else if (slip) status = Math.abs(slip.net_pay - pay!.net) > 0.5 || slip.data.paidDays !== pay!.paidDays ? 'stale' : 'ok';
      return { emp, att, pay, slip, status };
    });
  }, [data, rules]);

  const kept = useMemo(() => [...new Set([...(data?.months ?? []), month])].sort().reverse().slice(0, KEEP_MONTHS), [data, month]);
  const inWindow = kept.includes(month);
  const ready = rows.filter(r => r.status !== 'noatt' && r.status !== 'nosalary');
  const todo = rows.filter(r => r.status === 'new' || r.status === 'stale').length;
  const totals = ready.reduce((t, r) => ({ gross: t.gross + r.pay!.gross, ded: t.ded + r.pay!.totalDeductions, net: t.net + r.pay!.net }), { gross: 0, ded: 0, net: 0 });

  async function generate() {
    if (!ready.length) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const payload = ready.map(r => {
      const d = buildPayslip(r.emp, r.att!, rules, payDate);
      return { employee_id: r.emp.id, month, pay_date: payDate, net_pay: d.net, data: d, generated_at: new Date().toISOString() };
    });
    for (let i = 0; i < payload.length; i += 100) {
      const { error } = await sb.from('payslips').upsert(payload.slice(i, i + 100), { onConflict: 'employee_id,month' });
      if (error) { notify(error.message, 'err'); setBusy(false); return; }
    }
    const { data: removed } = await sb.rpc('purge_old_payslips', { keep_months: KEEP_MONTHS });
    setBusy(false);
    notify(`Generated ${payload.length} payslips for ${monthLabel(month)}` + (removed ? ` · removed ${removed} older payslips` : ''));
    reload();
  }

  /** Live numbers from the system when attendance exists (works for any month); otherwise the saved copy. */
  const slipData = (r: (typeof rows)[number]): PayslipData | null =>
    r.att && r.status !== 'nosalary' ? buildPayslip(r.emp, r.att, rules, r.slip?.pay_date ?? payDate) : r.slip?.data ?? null;

  async function saveOne(r: (typeof rows)[number]) {
    const d = slipData(r);
    if (!d || !inWindow) return;
    const sb = supabaseBrowser();
    const { error } = await sb.from('payslips').upsert(
      { employee_id: r.emp.id, month, pay_date: payDate, net_pay: d.net, data: { ...d, payDate }, generated_at: new Date().toISOString() },
      { onConflict: 'employee_id,month' });
    if (error) { notify(error.message, 'err'); return; }
    await sb.rpc('purge_old_payslips', { keep_months: KEEP_MONTHS });
    notify(`Payslip saved for ${r.emp.name}`);
    reload();
  }

  async function downloadAll() {
    const slips = [...(data?.slips ?? [])].sort((a, b) => a.data.employee.code.localeCompare(b.data.employee.code, undefined, { numeric: true }));
    if (!slips.length) return;
    await downloadPayslips(slips.map(s => s.data), company, `Payslips_${monthLabel(month, false).replace(' ', '_')}.pdf`);
  }

  const badge = (s: (typeof rows)[number]['status']) => ({
    noatt: <span className="pill warn">No attendance</span>,
    nosalary: <span className="pill warn">No salary set</span>,
    new: <span className="pill gray">Not generated</span>,
    ok: <span className="pill ok">Generated ✓</span>,
    stale: <span className="pill bad">Out of date</span>,
  })[s];

  return (
    <>
      <div className="page-h">
        <h2>Payroll &amp; Payslips</h2>
        <input type="month" value={ym} onChange={e => setYm(e.target.value || ym)} />
        <span className="sp" />
        {data && data.slips.length > 0 && <button className="btn" onClick={downloadAll}>Download all as one PDF</button>}
      </div>
      {error && <p className="err">{error}</p>}

      <div className="note" style={{ marginBottom: 16 }}>
        Pay = monthly salary ÷ days in the month × paid days. Paid days = present + ½ half-days + week offs + holidays + paid leave;
        the first {Number(settings.paid_leave_per_month)} absent day(s) each month count as paid leave. Payslips are saved here for the latest {KEEP_MONTHS} months
        and older ones are deleted automatically.
      </div>

      <div className="card">
        {canEdit && (
          <div className="row">
            <label className="muted small">Pay date <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></label>
            <button className="btn primary" disabled={busy || !ready.length || !payDate || !inWindow} onClick={generate}>
              {busy ? 'Generating…' : todo ? `Generate ${todo} payslip${todo > 1 ? 's' : ''} for ${monthLabel(month)}` : `Regenerate payslips for ${monthLabel(month)}`}
            </button>
            {!inWindow && <span className="err small">Only the latest {KEEP_MONTHS} months are kept, so {monthLabel(month)} can no longer be generated.</span>}
            {rows.some(r => r.status === 'noatt') && <span className="muted small">Employees without attendance are skipped — <Link href="/attendance">add attendance</Link>.</span>}
          </div>
        )}
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Employee</th><th>ID</th><th className="n">Paid days</th><th className="n">LOP</th><th className="n">Gross</th><th className="n">Deductions</th><th className="n">Net pay</th><th>Payslip</th><th /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.emp.id}>
                  <td><b>{r.emp.name}</b></td><td>{r.emp.emp_code}</td>
                  {r.pay ? (
                    <>
                      <td className="n">{r.pay.paidDays}</td><td className="n">{r.pay.lopDays}</td>
                      <td className="n">{inrWhole(r.pay.gross)}</td><td className="n">{inrWhole(r.pay.totalDeductions)}</td><td className="n"><b>{inrWhole(r.pay.net)}</b></td>
                    </>
                  ) : <td colSpan={5} />}
                  <td>{badge(r.status)}{r.slip && <span className="muted small"> · {fmtDate(r.slip.pay_date)}</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {(() => {
                      const d = slipData(r);
                      if (!d) return null;
                      return (
                        <>
                          <button className="btn sm" onClick={() => openPayslips([d], company)}>View</button>{' '}
                          <button className="btn sm" onClick={() => printPayslips([d], company)}>Print</button>{' '}
                          <button className="btn sm" onClick={() => downloadPayslips([d], company, payslipFilename(d))}>PDF</button>
                          {canEdit && inWindow && (r.status === 'new' || r.status === 'stale') && (
                            <> <button className="btn sm primary" onClick={() => saveOne(r)}>{r.status === 'stale' ? 'Regenerate' : 'Generate'}</button></>
                          )}
                        </>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {ready.length > 0 && (
                <tr>
                  <td colSpan={4}><b>Total ({ready.length} employees)</b></td>
                  <td className="n"><b>{inr(totals.gross)}</b></td><td className="n"><b>{inr(totals.ded)}</b></td><td className="n"><b>{inr(totals.net)}</b></td><td colSpan={2} />
                </tr>
              )}
              {!rows.length && !loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 26 }}>No employees yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
