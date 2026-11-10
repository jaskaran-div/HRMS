'use client';

import { useApp } from '../AppContext';
import { fmtDate, monthLabel } from '@/lib/dates';
import { inr } from '@/lib/format';
import { downloadPayslips, openPayslips, payslipFilename } from '@/lib/payslip-pdf';
import type { PayslipData } from '@/lib/types';

/** Saved (HR-generated) payslips with view / download. */
export function PayslipTable({ slips }: { slips: PayslipData[] }) {
  const { settings } = useApp();
  const company = { name: settings.company_name, address: settings.company_address, logo: settings.logo, footer: settings.footer_note };
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Month</th><th>Pay date</th><th className="n">Paid days</th><th className="n">Net pay</th><th /></tr></thead>
        <tbody>
          {slips.map(s => (
            <tr key={s.month}>
              <td><b>{monthLabel(s.month)}</b></td><td>{fmtDate(s.payDate)}</td><td className="n">{s.paidDays}</td><td className="n">{inr(s.net)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => openPayslips([s], company)}>View</button>{' '}
                <button className="btn sm primary" onClick={() => downloadPayslips([s], company, payslipFilename(s))}>Download PDF</button>
              </td>
            </tr>
          ))}
          {!slips.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 26 }}>No payslips yet. HR publishes them after each month&apos;s payroll.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
