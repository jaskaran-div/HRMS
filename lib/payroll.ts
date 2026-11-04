import type { Attendance, Employee, PayLine, PayslipData, Settings } from './types';
import { daysInMonth } from './dates';

export interface PayRules {
  paidLeavePerMonth: number;
  basicPct: number;
  hraPct: number;
  conveyancePct: number; // special allowance = the remainder
}

export const rulesFrom = (s: Settings): PayRules => ({
  paidLeavePerMonth: Number(s.paid_leave_per_month),
  basicPct: Number(s.basic_pct),
  hraPct: Number(s.hra_pct),
  conveyancePct: Number(s.conveyance_pct),
});

export interface AttendanceCounts {
  present: number;
  half: number;
  absent: number;
  leave: number; // leave already marked paid in the sheet
  weekoff: number;
  holiday: number;
}

export interface PayInput {
  salary: number;
  arrears: number;
  otherDeduction: number;
  pf: number;
  tds: number;
  att: AttendanceCounts;
  daysInMonth: number;
  carry?: Carry; // brought forward from the previous month
}

export interface Carry {
  arrears: number;
  deduction: number;
}

export interface PayResult {
  paidDays: number;
  lopDays: number;
  leaveConverted: number; // absent days covered by the monthly paid-leave allowance
  earnings: PayLine[];
  deductions: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
}

/**
 * paid days = present + half/2 + paid leave + week offs + holidays
 * The first `paidLeavePerMonth` absent days are paid (the monthly paid leave).
 * Pay = salary / days in month x paid days, rounded to the rupee, then split by the salary structure.
 */
export function computePay(i: PayInput, r: PayRules): PayResult {
  const a = i.att;
  const allowanceLeft = Math.max(0, r.paidLeavePerMonth - a.leave);
  const leaveConverted = Math.min(a.absent, allowanceLeft);
  const paidDays = Math.min(
    i.daysInMonth,
    a.present + a.half * 0.5 + a.leave + leaveConverted + a.weekoff + a.holiday,
  );
  const lopDays = Math.max(0, i.daysInMonth - paidDays);

  const earned = Math.round((i.salary * paidDays) / i.daysInMonth);
  const basic = Math.round((earned * r.basicPct) / 100);
  const hra = Math.round((earned * r.hraPct) / 100);
  const conv = Math.round((earned * r.conveyancePct) / 100);
  const special = earned - basic - hra - conv;

  const earnings: PayLine[] = [
    { label: 'Basic', amount: basic },
    { label: 'House Rent Allowance', amount: hra },
    { label: 'Conveyance Allowance', amount: conv },
    { label: 'Special Allowance', amount: special },
  ];
  const cArrears = i.carry?.arrears ?? 0;
  const cDeduction = i.carry?.deduction ?? 0;
  if (i.arrears > 0) earnings.push({ label: 'Arrears', amount: i.arrears });
  if (cArrears > 0) earnings.push({ label: 'Arrears (brought forward)', amount: cArrears });

  const deductions: PayLine[] = [
    { label: 'Income Tax', amount: i.tds },
    { label: 'Provident Fund', amount: i.pf },
  ];
  if (i.otherDeduction > 0) deductions.push({ label: 'Other Deductions', amount: i.otherDeduction });
  if (cDeduction > 0) deductions.push({ label: 'Deductions (brought forward)', amount: cDeduction });

  const gross = earned + (i.arrears > 0 ? i.arrears : 0) + cArrears;
  const totalDeductions = i.tds + i.pf + (i.otherDeduction > 0 ? i.otherDeduction : 0) + cDeduction;
  return { paidDays, lopDays, leaveConverted, earnings, deductions, gross, totalDeductions, net: gross - totalDeductions };
}

export const countsFrom = (a: Attendance): AttendanceCounts => ({
  present: Number(a.present_days),
  half: Number(a.half_days),
  absent: Number(a.absent_days),
  leave: Number(a.leave_days),
  weekoff: Number(a.weekoff_days),
  holiday: Number(a.holiday_days),
});

export function payFor(emp: Employee, a: Attendance, rules: PayRules, carry?: Carry): PayResult {
  const [y, m] = a.month.split('-').map(Number);
  return computePay({
    salary: Number(a.salary) || Number(emp.monthly_salary) || 0,
    arrears: Number(a.arrears),
    otherDeduction: Number(a.other_deduction),
    pf: Number(emp.pf_amount),
    tds: Number(emp.tds_amount),
    att: countsFrom(a),
    daysInMonth: daysInMonth(y, m),
    carry,
  }, rules);
}

/**
 * What the previous month leaves for this month (one month back, not chained):
 *  - arrears / deductions entered last month whose payslip was never generated are still owed, so they move on;
 *  - if last month's deductions exceeded its earnings, the shortfall is recovered this month.
 * `prevSlipSaved` = a payslip for last month exists (or was already purged, which means it was paid).
 */
export function carryFrom(
  emp: Employee, prev: Attendance | undefined, prevSlipSaved: boolean, rules: PayRules,
): Carry {
  const none = { arrears: 0, deduction: 0 };
  if (!prev || prev.carry_cleared) return none; // HR marked last month's arrears / deductions as already settled
  const p = payFor(emp, prev, rules);
  let arrears = 0;
  let deduction = 0;
  if (!prevSlipSaved) {
    arrears = Math.max(0, Number(prev.arrears));
    deduction = Math.max(0, Number(prev.other_deduction));
  }
  if (p.net < 0) deduction += -p.net;
  return { arrears, deduction };
}

export function buildPayslip(emp: Employee, a: Attendance, rules: PayRules, payDate: string, carry?: Carry): PayslipData {
  const [y, m] = a.month.split('-').map(Number);
  const p = payFor(emp, a, rules, carry);
  return {
    employee: { code: emp.emp_code, name: emp.name },
    month: a.month,
    payDate,
    daysInMonth: daysInMonth(y, m),
    paidDays: p.paidDays,
    lopDays: p.lopDays,
    earnings: p.earnings,
    deductions: p.deductions,
    gross: p.gross,
    totalDeductions: p.totalDeductions,
    net: p.net,
  };
}
