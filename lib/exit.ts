import { carryFrom, buildPayslip, type PayRules } from './payroll';
import { shiftMonth, toISODate } from './dates';
import type { Attendance, Employee, PayslipData, RelievingLetterData } from './types';

/** Header words HR may have used for the leaving date in the employee sheet (stored in `extra`). */
const LEAVING_KEY = /(date.?of.?(leav|relie|exit|resign)|(leav|relie|exit|resign)\w*.?date|last.?working|^lwd$|^dol$|^doe$)/i;

/** Name of the column the app writes when HR types a date of leaving. */
export const LEAVING_LABEL = 'Date of Leaving';

/** The employee's date of leaving (YYYY-MM-DD) from the sheet columns HR uploaded, or null if there is none. */
export function leavingDate(e: Employee): string | null {
  for (const [k, v] of Object.entries(e.extra ?? {})) {
    if (!LEAVING_KEY.test(k.trim())) continue;
    const iso = toISODate(v);
    if (iso) return iso;
  }
  return null;
}

/** Carry-forward into attendance row `a`. `prevIsBatch` = the previous month is generated in the same batch (so it counts as paid). */
export function carryInto(
  emp: Employee, att: Attendance[], slips: { month: string }[], a: Attendance, prevIsBatch: boolean, rules: PayRules,
) {
  const prevMonth = shiftMonth(a.month, -1);
  const oldest = slips.reduce<string | null>((o, s) => (o === null || s.month < o ? s.month : o), null);
  const saved = prevIsBatch || slips.some(s => s.month === prevMonth) || (oldest !== null && prevMonth < oldest);
  return carryFrom(emp, att.find(x => x.month === prevMonth), saved, rules);
}

/** Relieving letter + payslips for the last `months` months up to the month of leaving. */
export function buildExit(
  emp: Employee, att: Attendance[], slips: { month: string }[], rules: PayRules,
  relievedOn: string, months: 3 | 6, today: string,
): { letter: RelievingLetterData; payslips: PayslipData[] } {
  const relMonth = `${relievedOn.slice(0, 7)}-01`;
  const from = shiftMonth(relMonth, -(months - 1));
  const rows = att.filter(a => a.month >= from && a.month <= relMonth).sort((a, b) => (a.month < b.month ? -1 : 1));
  return {
    payslips: rows.map((a, i) => buildPayslip(emp, a, rules, today, carryInto(emp, att, slips, a, i > 0, rules))),
    letter: {
      employee: { code: emp.emp_code, name: emp.name, designation: emp.designation, department: emp.department },
      doj: emp.doj, relievedOn, issueDate: today,
    },
  };
}
