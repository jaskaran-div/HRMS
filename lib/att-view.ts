// Read-only attendance view for the employee / team leader panels: what each day of a month shows.
import { daysInMonth, isOffSaturday } from './dates';
import type { LeaveRequest } from './types';

export type DayCode = 'P' | 'A' | 'W' | 'H' | 'L' | 'S' | 'O';
export interface DayView {
  code: DayCode | '';
  /** marked = HR marked it; auto = 2nd / 4th Saturday week off; leave = approved leave not marked yet; off = before joining */
  kind: 'marked' | 'auto' | 'leave' | 'off' | 'empty';
  label: string;
}

export const CODE_LABEL: Record<DayCode, string> = {
  P: 'Present', A: 'Absent', W: 'Week off', H: 'Half day', L: 'Paid leave', S: 'Short leave', O: 'Holiday',
};
export const CODE_CLS: Record<DayCode, string> = { P: 'p', A: 'a', W: 'w', H: 'h', L: 'l', S: 's', O: 'o' };
const LEAVE_CODE = { short: 'S', paid: 'L', unpaid: 'A' } as const;

export type ViewLeave = Pick<LeaveRequest, 'leave_type' | 'start_date' | 'end_date'>;

/** month = YYYY-MM-01. Mirrors the HR grid: marked days, auto week offs, approved leave on unmarked days, greyed days before joining. */
export function monthDays(month: string, daily: Record<string, string> | null | undefined, doj: string | null | undefined, leaves: ViewLeave[] = []): DayView[] {
  const [y, m] = month.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const ym = month.slice(0, 7);
  let first = 1;
  if (doj) {
    const [jy, jm, jd] = doj.split('-').map(Number);
    if (jy > y || (jy === y && jm > m)) first = 99;
    else if (jy === y && jm === m) first = jd;
  }
  const out: DayView[] = [];
  for (let d = 1; d <= dim; d++) {
    if (d < first) { out.push({ code: '', kind: 'off', label: 'Not joined yet' }); continue; }
    const v = daily?.[String(d)] as DayCode | undefined;
    if (v && CODE_LABEL[v]) { out.push({ code: v, kind: 'marked', label: CODE_LABEL[v] }); continue; }
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    const wd = new Date(y, m - 1, d).getDay();
    const lv = wd !== 0 && !isOffSaturday(y, m, d) ? leaves.find(l => iso >= l.start_date && iso <= l.end_date) : undefined;
    if (lv) { const c = LEAVE_CODE[lv.leave_type]; out.push({ code: c, kind: 'leave', label: `Approved ${CODE_LABEL[c].toLowerCase()} (not marked by HR yet)` }); continue; }
    if (isOffSaturday(y, m, d)) { out.push({ code: 'W', kind: 'auto', label: 'Week off (2nd / 4th Saturday)' }); continue; }
    out.push({ code: '', kind: 'empty', label: 'Not marked' });
  }
  return out;
}

export function countDays(days: DayView[]) {
  const c: Record<DayCode, number> = { P: 0, A: 0, W: 0, H: 0, L: 0, S: 0, O: 0 };
  for (const d of days) if (d.code && d.kind !== 'leave') c[d.code]++;
  return c;
}

/** YYYY-MM from ?month=, else null. */
export const monthParam = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null;
};
