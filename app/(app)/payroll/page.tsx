'use client';

import { ErrorBox } from '@/components/ui';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { buildPayslip, payFor, rulesFrom } from '@/lib/payroll';
import { loadCarry } from '@/lib/carry';
import { currentYM, fmtDate, monthLabel, monthStart, shiftMonth, todayISO } from '@/lib/dates';
import { employedIn, leavingDate } from '@/lib/exit';
import { inr, inrWhole } from '@/lib/format';
import { downloadPayslips, openPayslips, printPayslips, payslipFilename } from '@/lib/payslip-pdf';
import { emailPayslips } from '@/lib/send-email';
import { TEMPLATE_META, type EmailTemplateType } from '@/lib/email-templates';
import type { PayslipData } from '@/lib/types';
import type { Attendance, Employee, PayslipRow } from '@/lib/types';

import { ask } from '@/components/Dialog';
import { officialEmailOf } from '@/lib/official-email';
const KEEP_MONTHS = 2;
const NO_MAIL = 'Email is not set up on the server yet: add SMTP_HOST, SMTP_USER and SMTP_PASS to .env.local (and to Vercel → Settings → Environment Variables), then restart / redeploy.';

export default function PayrollPage() {
  const { canEdit, settings, notify, mailReady } = useApp();
  const rules = rulesFrom(settings);
  const company = { name: settings.company_name, address: settings.company_address, logo: settings.logo, footer: settings.footer_note };
  const [ym, setYm] = useState(() => shiftMonth(`${currentYM()}-01`, -1).slice(0, 7));
  const month = monthStart(ym);
  const [payDate, setPayDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [mailType, setMailType] = useState<EmailTemplateType>('payslip');
  const [mailing, setMailing] = useState<string | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [allEmps, att, slips, months, exits] = await Promise.all([
      fetchAll<Employee>((a, b) => sb.from('employees').select('*').order('emp_code').range(a, b)),
      fetchAll<Attendance>((a, b) => sb.from('attendance').select('*').eq('month', month).range(a, b)),
      fetchAll<PayslipRow>((a, b) => sb.from('payslips').select('*').eq('month', month).range(a, b)),
      fetchAll<{ month: string }>((a, b) => sb.from('payslips').select('month').range(a, b)),
      fetchAll<{ employee_id: string; relieved_on: string }>((a, b) => sb.from('exit_records').select('employee_id, relieved_on').range(a, b)),
    ]);
    const leftOn = new Map(exits.map(x => [x.employee_id, x.relieved_on]));
    const emps = allEmps.filter(e => employedIn(e, month, leftOn.get(e.id) ?? null));
    const hidden = allEmps.filter(e => !e.archived_at).length - emps.filter(e => !e.archived_at).length;
    const carry = await loadCarry(sb, month, emps, rules);
    return { emps, att, slips, carry, hidden, leftOn, months: [...new Set(months.map(x => x.month))] };
  }, [month]);

  const rows = useMemo(() => {
    const attBy = new Map((data?.att ?? []).map(a => [a.employee_id, a]));
    const slipBy = new Map((data?.slips ?? []).map(s => [s.employee_id, s]));
    return (data?.emps ?? []).map(emp => {
      const att = attBy.get(emp.id);
      const carry = data?.carry.get(emp.id);
      const pay = att ? payFor(emp, att, rules, carry) : null;
      const slip = slipBy.get(emp.id);
      const hasSalary = !!att && (Number(att.salary) > 0 || Number(emp.monthly_salary) > 0);
      let status: 'noatt' | 'nosalary' | 'new' | 'ok' | 'stale' = 'new';
      if (!att) status = 'noatt';
      else if (!hasSalary) status = 'nosalary';
      else if (slip) status = Math.abs(slip.net_pay - pay!.net) > 0.5 || slip.data.paidDays !== pay!.paidDays ? 'stale' : 'ok';
      return { emp, att, pay, slip, status, carry };
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
      const d = buildPayslip(r.emp, r.att!, rules, payDate, r.carry);
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

  type Row = (typeof rows)[number];

  /** Live numbers from the system when attendance exists (works for any month); otherwise the saved copy. */
  const slipData = (r: Row): PayslipData | null =>
    r.att && r.status !== 'nosalary' ? buildPayslip(r.emp, r.att, rules, r.slip?.pay_date ?? payDate, r.carry) : r.slip?.data ?? null;

  /** Saves this employee's payslip with the current numbers. Returns what was saved, or null on failure. */
  async function saveOne(r: Row, quiet = false): Promise<PayslipData | null> {
    const d0 = slipData(r);
    if (!d0 || !inWindow) return null;
    const d = { ...d0, payDate };
    const sb = supabaseBrowser();
    const { error } = await sb.from('payslips').upsert(
      { employee_id: r.emp.id, month, pay_date: payDate, net_pay: d.net, data: d, generated_at: new Date().toISOString() },
      { onConflict: 'employee_id,month' });
    if (error) { notify(error.message, 'err'); return null; }
    await sb.rpc('purge_old_payslips', { keep_months: KEEP_MONTHS });
    if (!quiet) notify(`Payslip saved for ${r.emp.name}`);
    reload();
    return d;
  }

  async function downloadAll() {
    const slips = [...(data?.slips ?? [])].sort((a, b) => a.data.employee.code.localeCompare(b.data.employee.code, undefined, { numeric: true }));
    if (!slips.length) return;
    await downloadPayslips(slips.map(s => s.data), company, `Payslips_${monthLabel(month, false).replace(' ', '_')}.pdf`);
  }

  const mailable = (r: Row) => !!r.slip && !!officialEmailOf(r.emp);

  /**
   * `only` = one employee: if their payslip is not generated yet (or is out of date) it is saved first, then emailed.
   * Without `only`: every employee with a generated payslip this month.
   */
  async function sendMail(only?: Row) {
    if (!mailReady) { notify(NO_MAIL, 'err'); return; }
    if (only && !officialEmailOf(only.emp)) { notify(`${only.emp.name} has no official mail. Add it on their profile (Edit details) first.`, 'err'); return; }
    const targets = only ? [only] : rows.filter(mailable);
    const noEmail = only ? 0 : rows.filter(r => r.slip && !officialEmailOf(r.emp)).length;
    if (!targets.length) { notify('Nobody here has a generated payslip and an official mail.', 'err'); return; }
    const title = TEMPLATE_META.find(t => t.type === mailType)!.title;
    const mustSave = !!only && (only.status === 'new' || only.status === 'stale');
    if (mustSave && !inWindow) { notify(`Payslips for ${monthLabel(month)} can no longer be generated, so this one cannot be emailed.`, 'err'); return; }
    const who = targets.length === 1 ? `${targets[0].emp.name} (${officialEmailOf(targets[0].emp)})` : `${targets.length} employees`;
    const skipped = noEmail ? `\n\n${noEmail} employee(s) have no official mail and will be skipped.` : '';
    const verb = mustSave ? (only!.status === 'new' ? 'Generate and email' : 'Regenerate and email') : 'Email';
    if (!(await ask.confirm({ title: `${verb} the ${monthLabel(month)} payslip${targets.length === 1 ? '' : 's'}?`, confirmText: 'Send email',
      message: `To ${who}, using the "${title}" template.${skipped}` }))) return;
    setMailing(only ? only.emp.id : 'all');
    try {
      let single: PayslipData | null = null;
      if (only) {
        single = mustSave ? await saveOne(only, true) : only.slip!.data;
        if (!single) { setMailing(null); return; }
      }
      const res = await emailPayslips(mailType, targets.map(r => ({ employee_id: r.emp.id, name: r.emp.name, payslips: [single ?? r.slip!.data] })), company);
      if (res.failed.length) {
        notify(`Sent ${res.sent}, failed ${res.failed.length}: ${res.failed.slice(0, 2).map(f => `${f.name} (${f.error})`).join('; ')}${res.failed.length > 2 ? '…' : ''}`, 'err');
      } else notify(`Emailed ${res.sent} payslip${res.sent === 1 ? '' : 's'}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err');
    }
    setMailing(null);
  }

  const badge = (s: Row['status']) => ({
    noatt: <span className="pill warn">No attendance</span>,
    nosalary: <span className="pill warn">No salary set</span>,
    new: <span className="pill gray">Not generated</span>,
    ok: <span className="pill ok">Generated ✓</span>,
    stale: <span className="pill bad">Out of date</span>,
  })[s];

  const tags = (e: Employee) => {
    const left = data?.leftOn.get(e.id) ?? leavingDate(e);
    return (
      <>
        {e.doj && e.doj.slice(0, 7) === ym && <> <span className="pill gray">Joined {fmtDate(e.doj)}</span></>}
        {left && left.slice(0, 7) === ym && <> <span className="pill warn">Left {fmtDate(left)}</span></>}
        {e.archived_at && !(left && left.slice(0, 7) === ym) && <> <span className="pill gray">Inactive now</span></>}
      </>
    );
  };

  return (
    <>
      <div className="page-h">
        <input type="month" value={ym} onChange={e => setYm(e.target.value || ym)} />
        <span className="sp" />
        {data && data.slips.length > 0 && <button className="btn" onClick={downloadAll}>Download all as one PDF</button>}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {canEdit && !mailReady && <div className="note warn" style={{ marginBottom: 12 }}>{NO_MAIL}</div>}

      <div className="note" style={{ marginBottom: 16 }}>
        Pay = monthly salary ÷ days in the month × paid days. Paid days = present + ½ half-days + week offs + holidays + paid leave;
        the first {Number(settings.paid_leave_per_month)} absent day(s) each month count as paid leave; the 2nd and 4th Saturday are week offs.
        Last month&apos;s arrears / deductions that were never paid on a payslip (and any negative net pay) are brought forward into this month automatically.
        Only employees who worked in the chosen month are listed (by date of joining and date of leaving); inactive employees appear up to their month of leaving.
        Payslips are saved here for the latest {KEEP_MONTHS} months and older ones are deleted automatically.
      </div>

      <div className="card">
        {canEdit && (
          <div className="row">
            <label className="muted small">Pay date <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></label>
            <button className="btn primary" disabled={busy || !ready.length || !payDate || !inWindow} onClick={generate}>
              {busy ? 'Generating…' : todo ? `Generate ${todo} payslip${todo > 1 ? 's' : ''} for ${monthLabel(month)}` : `Regenerate payslips for ${monthLabel(month)}`}
            </button>
            <select value={mailType} onChange={e => setMailType(e.target.value as EmailTemplateType)} aria-label="Email template">
              {TEMPLATE_META.filter(t => t.type !== 'payslip_fnf').map(t => <option key={t.type} value={t.type}>{t.title}</option>)}
            </select>
            {data && data.slips.length > 0 && (
              <button className="btn" disabled={!!mailing} onClick={() => sendMail()}>{mailing === 'all' ? 'Sending…' : 'Email all payslips'}</button>
            )}
            {!inWindow && <span className="err small">Only the latest {KEEP_MONTHS} months are kept, so {monthLabel(month)} can no longer be generated.</span>}
            {!!data?.hidden && <span className="muted small">{data.hidden} active employee(s) not employed in {monthLabel(month)} (joined later or left earlier) are hidden.</span>}
            {rows.some(r => r.status === 'noatt') && <span className="muted small">Employees without attendance are skipped — <Link href="/attendance">add attendance</Link>.</span>}
          </div>
        )}
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Employee</th><th>ID</th><th className="n">Paid days</th><th className="n">LOP</th><th className="n">Gross</th><th className="n">Deductions</th><th className="n">Net pay</th><th>Payslip</th><th /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.emp.id}>
                  <td><b>{r.emp.name}</b>{tags(r.emp)}</td><td>{r.emp.emp_code}</td>
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
                          {canEdit && (r.slip || inWindow) && (
                            <> <button className="btn sm" disabled={!!mailing}
                              title={!mailReady ? 'Email is not set up on the server' : officialEmailOf(r.emp) ? `Email to ${officialEmailOf(r.emp)}` : 'No official mail on file'}
                              onClick={() => sendMail(r)}>{mailing === r.emp.id ? 'Sending…' : 'Email'}</button></>
                          )}
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
              {!rows.length && !loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 26 }}>No employees worked in {monthLabel(month)}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
