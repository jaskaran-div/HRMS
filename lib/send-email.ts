import { payslipDocument, pdfMake, payslipFilename, type PayslipCompany } from './payslip-pdf';
import { relievingDocument, relievingFilename } from './relieving-pdf';
import { fmtDate, monthLabel } from './dates';
import { inr } from './format';
import type { EmailTemplateType } from './email-templates';
import type { PayslipData, RelievingLetterData } from './types';

export interface MailJob {
  employee_id: string;
  name: string;
  payslips: PayslipData[];
  /** Final settlement only: the relieving letter is attached too. */
  letter?: RelievingLetterData;
  lastWorkingDay?: string;
}

export interface MailOutcome { sent: number; failed: { name: string; error: string }[] }

const CHUNK = 5; // keeps each request well under the 4.5 MB Vercel body limit

/** Builds the PDFs in the browser and posts them to /api/email/send in small batches. */
export async function emailPayslips(
  type: EmailTemplateType, jobs: MailJob[], company: PayslipCompany, onProgress?: (done: number) => void,
): Promise<MailOutcome> {
  const pm = await pdfMake();
  const out: MailOutcome = { sent: 0, failed: [] };
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const part = jobs.slice(i, i + CHUNK);
    const items = await Promise.all(part.map(async j => {
      const first = j.payslips[0];
      const attachments = [{
        filename: j.payslips.length === 1 ? payslipFilename(first) : `Payslips_${first.employee.code}.pdf`,
        base64: await pm.createPdf(payslipDocument(j.payslips, company)).getBase64(),
      }];
      if (j.letter) attachments.push({ filename: relievingFilename(j.letter), base64: await pm.createPdf(relievingDocument(j.letter, company)).getBase64() });
      const last = j.payslips[j.payslips.length - 1];
      return {
        employee_id: j.employee_id,
        attachments,
        vars: {
          PayPeriodMonth: last ? monthLabel(last.month) : '',
          PayDate: last ? fmtDate(last.payDate) : '',
          NetPay: last ? inr(last.net) : '',
          LastWorkingDay: j.lastWorkingDay ? fmtDate(j.lastWorkingDay) : '',
        },
      };
    }));
    const res = await fetch('/api/email/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, items }),
    });
    const json = (await res.json().catch(() => ({}))) as { results?: { employee_id: string; ok: boolean; error?: string }[]; error?: string };
    if (!res.ok || !json.results) {
      const error = json.error ?? `Server error (${res.status})`;
      part.forEach(j => out.failed.push({ name: j.name, error }));
    } else {
      for (const r of json.results) {
        if (r.ok) out.sent++;
        else out.failed.push({ name: part.find(j => j.employee_id === r.employee_id)?.name ?? r.employee_id, error: r.error ?? 'Failed' });
      }
    }
    onProgress?.(Math.min(i + CHUNK, jobs.length));
  }
  return out;
}
