import type { SheetRow } from './sheet';
import { norm, num } from './format';
import { daysInMonth, monthFromName } from './dates';
import type { AttendanceCounts } from './payroll';

export type DayStatus = 'present' | 'absent' | 'weekoff' | 'half' | 'leave' | 'holiday' | 'blank' | 'unknown';

const STATUS: Record<string, DayStatus> = {
  present: 'present', p: 'present', pr: 'present',
  absent: 'absent', a: 'absent', ab: 'absent',
  weekoff: 'weekoff', wo: 'weekoff', off: 'weekoff', sunday: 'weekoff', sun: 'weekoff',
  halfday: 'half', half: 'half', hd: 'half',
  paidleave: 'leave', pl: 'leave', leave: 'leave', cl: 'leave', sl: 'leave', el: 'leave', casualleave: 'leave', sickleave: 'leave',
  holiday: 'holiday', ph: 'holiday', publicholiday: 'holiday', h: 'holiday',
};

export const statusOf = (v: unknown): DayStatus => {
  const k = norm(v);
  return k === '' ? 'blank' : STATUS[k] ?? 'unknown';
};

const CODE: Partial<Record<DayStatus, string>> = {
  present: 'P', absent: 'A', weekoff: 'W', half: 'H', leave: 'L', holiday: 'O',
};

const COLUMNS: Record<string, string[]> = {
  code: ['employeeid', 'empid', 'empcode', 'employeecode', 'id', 'empno'],
  name: ['employeename', 'name', 'employee', 'empname', 'fullname'],
  salary: ['salary', 'monthlysalary', 'grosssalary'],
  arrears: ['arrears', 'arrear'],
  deduction: ['deduction', 'deductions', 'otherdeduction', 'otherdeductions'],
  present: ['presentdays', 'present', 'dayspresent'],
  absent: ['unpaiddays', 'absentdays', 'absent', 'lop', 'lopdays'],
  half: ['halfday', 'halfdays'],
  leave: ['paidleavedays', 'paidleave', 'leavedays', 'leavestaken', 'leaves'],
  weekoff: ['sundayweekoff', 'weekoff', 'weekoffs', 'weekoffdays'],
};
const LOOKUP = new Map<string, string>();
Object.entries(COLUMNS).forEach(([k, list]) => list.forEach(a => LOOKUP.set(a, k)));

/** Which day of the selected month does this header stand for? 'other' = a date in a different month. */
export function headerDay(header: string, month: number, dim: number): number | 'other' | null {
  const s = header.trim();
  let m = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})(?:[\s\-/.,]+\d{2,4})?$/.exec(s);
  if (m) {
    const mo = monthFromName(m[2]);
    if (!mo) return null;
    return mo === month && +m[1] >= 1 && +m[1] <= dim ? +m[1] : 'other';
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return +m[2] === month ? +m[3] : 'other';
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2];
    if (b === month && a >= 1 && a <= dim) return a; // dd/mm
    if (a === month && b >= 1 && b <= dim) return b; // mm/dd
    return 'other';
  }
  m = /^\d{1,2}$/.exec(s);
  if (m && +s >= 1 && +s <= dim) return +s;
  return null;
}

export interface ParsedAttendanceRow {
  row: number;
  code: string | null;
  name: string;
  salary: number | null;
  arrears: number;
  otherDeduction: number;
  counts: AttendanceCounts;
  daily: Record<string, string> | null;
  source: 'daily' | 'summary';
  unknownCells: number;
}

export interface ParsedAttendance {
  rows: ParsedAttendanceRow[];
  warnings: string[];
  dayColumns: number;
}

/** year / month (1-12) are the month the sheet is for, chosen by the user. */
export function parseAttendance(rows: SheetRow[], year: number, month: number): ParsedAttendance {
  const dim = daysInMonth(year, month);
  const warnings: string[] = [];
  const out: ParsedAttendanceRow[] = [];
  const headers = rows.length ? Object.keys(rows[0]) : [];

  const dayCols = new Map<string, number>(); // header -> day number
  const otherMonthCols: string[] = [];
  for (const h of headers) {
    const d = headerDay(h.replace(/__\d+$/, ''), month, dim);
    if (typeof d === 'number') dayCols.set(h, d);
    else if (d === 'other') otherMonthCols.push(h);
  }
  if (otherMonthCols.length)
    warnings.push(`Ignored ${otherMonthCols.length} date column(s) from another month (${otherMonthCols.slice(0, 3).join(', ')}…). Check you picked the right month.`);
  const useDaily = dayCols.size >= 10;
  if (dayCols.size > 0 && !useDaily)
    warnings.push(`Only ${dayCols.size} day columns found; using the summary columns instead.`);

  const field = (r: SheetRow, key: string): unknown => {
    for (const [h, v] of Object.entries(r)) if (LOOKUP.get(norm(h.replace(/__\d+$/, ''))) === key) return v;
    return '';
  };

  rows.forEach((r, idx) => {
    const name = String(field(r, 'name') ?? '').trim();
    const code = String(field(r, 'code') ?? '').trim().toUpperCase() || null;
    if ((!name && !code) || /^total/i.test(name)) return;

    const counts: AttendanceCounts = { present: 0, half: 0, absent: 0, leave: 0, weekoff: 0, holiday: 0 };
    let daily: Record<string, string> | null = null;
    let unknownCells = 0;

    if (useDaily) {
      daily = {};
      for (const [h, d] of dayCols) {
        const st = statusOf(r[h]);
        if (st === 'unknown') { unknownCells++; continue; }
        if (st === 'blank') continue;
        daily[String(d)] = CODE[st]!;
        counts[st as keyof AttendanceCounts]++;
      }
    } else {
      counts.present = num(field(r, 'present'));
      counts.absent = num(field(r, 'absent'));
      counts.half = num(field(r, 'half'));
      counts.leave = num(field(r, 'leave'));
      counts.weekoff = num(field(r, 'weekoff'));
    }
    if (unknownCells) warnings.push(`${name || code}: ${unknownCells} unreadable day value(s) were ignored.`);

    const sal = field(r, 'salary');
    out.push({
      row: idx + 2,
      code,
      name,
      salary: sal === '' ? null : num(sal),
      arrears: num(field(r, 'arrears')),
      otherDeduction: num(field(r, 'deduction')),
      counts,
      daily,
      source: useDaily ? 'daily' : 'summary',
      unknownCells,
    });
  });

  if (!out.length) warnings.push('No employee rows found. The sheet needs an "Employee Name" (or "Employee ID") column.');
  return { rows: out, warnings, dayColumns: dayCols.size };
}
