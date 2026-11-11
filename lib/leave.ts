import { isOffSaturday } from './dates';
import type { LeaveRequest, LeaveStatus, LeaveType, Settings } from './types';

export const LEAVE_TYPES: { type: LeaveType; label: string; hint: string }[] = [
  { type: 'short', label: 'Short leave', hint: 'A few hours on one day, paid' },
  { type: 'paid', label: 'Paid leave', hint: 'Full day, salary not cut' },
  { type: 'unpaid', label: 'Absent (unpaid leave)', hint: 'Salary is cut for these days' },
];

export const leaveLabel = (t: LeaveType) => LEAVE_TYPES.find(x => x.type === t)?.label ?? t;

export const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};
export const STATUS_PILL: Record<LeaveStatus, string> = { pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: 'gray' };

/** Requests that still use up the monthly quota. */
export const counts = (l: Pick<LeaveRequest, 'status'>) => l.status === 'pending' || l.status === 'approved';

const pad = (n: number) => String(n).padStart(2, '0');
const parse = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Sunday or the 2nd / 4th Saturday (the company's week offs). */
export function isWeekOff(day: string): boolean {
  const d = parse(day);
  return d.getDay() === 0 || isOffSaturday(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Working days from start to end (inclusive), skipping week offs. */
export function workingDays(start: string, end: string): number {
  let n = 0;
  for (let d = parse(start); iso(d) <= end; d.setDate(d.getDate() + 1)) if (!isWeekOff(iso(d))) n++;
  return n;
}

export interface Quota { shortLeft: number; paidLeft: number; shortPerMonth: number; paidPerMonth: number }

/** What is left this month (`month` = YYYY-MM-01) after the employee's existing requests. `ignoreId` = the request being edited. */
export function quotaFor(
  leaves: Pick<LeaveRequest, 'id' | 'leave_type' | 'start_date' | 'days' | 'status'>[],
  month: string, s: Pick<Settings, 'short_leave_per_month' | 'paid_leave_per_month'>, ignoreId?: string,
): Quota {
  const ym = month.slice(0, 7);
  const mine = leaves.filter(l => l.id !== ignoreId && counts(l) && l.start_date.slice(0, 7) === ym);
  const shortPerMonth = Number(s.short_leave_per_month ?? 1);
  const paidPerMonth = Number(s.paid_leave_per_month ?? 1);
  const shortUsed = mine.filter(l => l.leave_type === 'short').length;
  const paidUsed = mine.filter(l => l.leave_type === 'paid').reduce((n, l) => n + Number(l.days), 0);
  return { shortPerMonth, paidPerMonth, shortLeft: Math.max(0, shortPerMonth - shortUsed), paidLeft: Math.max(0, paidPerMonth - paidUsed) };
}

/**
 * Leave types the employee may pick. Short leave only while the monthly short leave is unused.
 * Paid leave can always be requested: beyond the monthly allowance it is "over the limit" and HR decides
 * when approving whether it counts as paid leave or absent.
 */
export function availableTypes(q: Quota): LeaveType[] {
  const out: LeaveType[] = [];
  if (q.shortLeft > 0) out.push('short');
  out.push('paid', 'unpaid');
  return out;
}

export interface LeaveInput { leave_type: LeaveType; start_date: string; end_date: string; reason?: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_UNPAID_DAYS = 31;

/**
 * Checks a request against the rules. Returns the number of days it counts for, or an error.
 * `existing` = the employee's other requests (any status); `today` = YYYY-MM-DD.
 */
export function validateLeave(
  input: LeaveInput, existing: Pick<LeaveRequest, 'id' | 'leave_type' | 'start_date' | 'end_date' | 'days' | 'status'>[],
  s: Pick<Settings, 'short_leave_per_month' | 'paid_leave_per_month'>, today: string,
): { ok: true; days: number; overQuota: boolean } | { ok: false; error: string } {
  const { leave_type: t, start_date: a } = input;
  const b = t === 'short' ? a : input.end_date || a;
  if (!LEAVE_TYPES.some(x => x.type === t)) return { ok: false, error: 'Pick a leave type.' };
  if (!ISO.test(a) || !ISO.test(b)) return { ok: false, error: 'Pick the date(s).' };
  if (b < a) return { ok: false, error: 'The end date is before the start date.' };
  const back = new Date(parse(today)); back.setDate(back.getDate() - 30);
  if (a < iso(back)) return { ok: false, error: 'Leave can be applied at most 30 days back.' };
  const ahead = new Date(parse(today)); ahead.setFullYear(ahead.getFullYear() + 1);
  if (b > iso(ahead)) return { ok: false, error: 'Leave can be applied at most a year ahead.' };

  const clash = existing.find(l => counts(l) && l.start_date <= b && l.end_date >= a);
  if (clash) return { ok: false, error: `You already have a ${leaveLabel(clash.leave_type).toLowerCase()} request on these dates.` };

  const days = t === 'short' ? 1 : workingDays(a, b);
  if (days === 0) return { ok: false, error: 'Those dates are all week offs.' };
  if (t === 'short' && isWeekOff(a)) return { ok: false, error: 'That day is a week off.' };

  if (t !== 'unpaid' && a.slice(0, 7) !== b.slice(0, 7)) return { ok: false, error: 'Paid leave must be within one month.' };
  const q = quotaFor(existing, `${a.slice(0, 7)}-01`, s);
  if (t === 'short' && q.shortLeft <= 0)
    return { ok: false, error: `Your short leave for this month is used (${q.shortPerMonth} per month). Apply as absent instead.` };
  if (t !== 'short' && days > MAX_UNPAID_DAYS) return { ok: false, error: `Apply for at most ${MAX_UNPAID_DAYS} working days at a time.` };
  // paid leave beyond the monthly allowance is allowed, but HR decides whether it is paid or absent
  return { ok: true, days, overQuota: t === 'paid' && days > q.paidLeft };
}

type Steps = Pick<LeaveRequest, 'status' | 'tl_status' | 'hr_status' | 'tl_by_name' | 'hr_by_name'> & Partial<Pick<LeaveRequest, 'tl_at' | 'hr_at'>>;

/**
 * Overall status from the two steps. The FIRST decision wins: whichever of the team leader or HR approves / declines
 * first settles the request, and the other no longer needs to act. (Old rows where both decided differently: declined.)
 */
export function overallStatus(tl: LeaveRequest['tl_status'], hr: LeaveRequest['hr_status']): Exclude<LeaveStatus, 'cancelled'> {
  if (tl === 'rejected' || hr === 'rejected') return 'rejected';
  if (tl === 'approved' || hr === 'approved') return 'approved';
  return 'pending';
}

/** Which step settled a decided request ('tl' / 'hr'), or null while nobody has decided. */
export function decidedBy(l: Steps): 'tl' | 'hr' | null {
  const tl = l.tl_status === 'approved' || l.tl_status === 'rejected';
  const hr = l.hr_status === 'approved' || l.hr_status === 'rejected';
  if (tl && hr) return (l.tl_at ?? '') >= (l.hr_at ?? '') ? 'tl' : 'hr'; // old rows: the latest decision
  return tl ? 'tl' : hr ? 'hr' : null;
}

/** May this step (still) approve / decline? Anyone while pending; afterwards only the one who decided (to change their mind). */
export function canDecideStep(l: Steps, step: 'tl' | 'hr'): boolean {
  if (l.status === 'cancelled') return false;
  if (step === 'tl' && l.tl_status === 'not_required') return false;
  if (l.status === 'pending') return true;
  return decidedBy(l) === step;
}

/** One line everyone sees, e.g. "Approved by team leader (Aman)". */
export function stageText(l: Steps): string {
  if (l.status === 'cancelled') return 'Cancelled by employee';
  const tlName = l.tl_by_name ? ` (${l.tl_by_name})` : '';
  const hrName = l.hr_by_name ? ` (${l.hr_by_name})` : '';
  const by = decidedBy(l);
  if (by && l.status !== 'pending') {
    const word = l.status === 'approved' ? 'Approved' : 'Declined';
    return by === 'tl' ? `${word} by team leader${tlName}` : `${word} by HR${hrName}`;
  }
  if (l.tl_status === 'not_required') return 'Pending with HR';
  return 'Pending with team leader or HR';
}
