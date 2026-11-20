import type { Settings, ShortSession } from './types';

export type InStatus = 'on_time' | 'late' | 'half_day';

/** 'HH:MM' or 'HH:MM:SS' -> minutes after midnight, or null. */
export function toMinutes(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Minutes after midnight in India for a moment (the server runs in UTC). */
export function minutesIST(at = new Date()): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(at).split(':').map(Number);
  return h * 60 + m;
}

/** 'HH:MM' (24h) or minutes -> '10:30 AM'. */
export function fmtTime(t: string | number | null | undefined): string {
  const v = typeof t === 'number' ? t : toMinutes(t);
  if (v == null) return '—';
  const h = Math.floor(v / 60) % 24, m = v % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export type LateRules = Pick<Settings, 'office_start_time' | 'late_grace_until' | 'late_allowed_per_month'>
  & Partial<Pick<Settings, 'checkin_close_time' | 'second_half_start' | 'morning_short_back' | 'checkin_extra_min' | 'office_end_time' | 'checkout_by'>>;

/** An employee's shift ('HH:MM[:SS]'); null = the company office timing. */
export type ShiftTimes = { start_time: string; end_time: string } | null | undefined;

const LAST_MINUTE = 23 * 60 + 59;

/**
 * The day's windows in minutes after midnight, or null when there is no office timing rule.
 * With a shift, every check-in window keeps its distance from the office start time but starts from the shift start,
 * and the check-out deadline keeps its distance from the office end time but follows the shift end.
 */
export function windows(s: LateRules, shift?: ShiftTimes) {
  const officeStart = toMinutes(s.office_start_time);
  if (officeStart == null) return null;
  const shiftStart = toMinutes(shift?.start_time);
  const move = shiftStart == null ? 0 : shiftStart - officeStart;
  const at = (t: number) => Math.min(LAST_MINUTE, Math.max(0, t + move));
  const start = at(officeStart);
  const grace = Math.max(start, at(toMinutes(s.late_grace_until) ?? officeStart));
  const close = Math.max(grace, at(toMinutes(s.checkin_close_time) ?? officeStart));
  const extra = Math.max(0, Number(s.checkin_extra_min ?? 60));
  const second = Math.max(close, at(toMinutes(s.second_half_start) ?? officeStart));
  const shortBack = toMinutes(s.morning_short_back);

  const officeEnd = toMinutes(s.office_end_time);
  const outBy = toMinutes(s.checkout_by);
  const shiftEnd = toMinutes(shift?.end_time);
  const end = shiftEnd ?? officeEnd;
  // check-out deadline: the same distance after the (shift) end as checkout_by is after the office end
  const checkoutBy = outBy == null ? null
    : Math.min(LAST_MINUTE, shiftEnd != null && officeEnd != null ? shiftEnd + Math.max(0, outBy - officeEnd) : outBy + move);
  return {
    start, grace, close, second, extra, end,
    /** nobody checked in by now = Absent */
    deadline: Math.min(LAST_MINUTE, second + extra),
    /** morning short leave: check in by this */
    shortUntil: shortBack == null ? close : Math.max(close, at(shortBack) + extra),
    allowed: Number(s.late_allowed_per_month ?? 3),
    /** check-out allowed until this; checked in but not out by then = Half day (null = no check-out rule) */
    checkoutBy,
  };
}

/** Check-out now: allowed until the check-out deadline. */
export function decideCheckOut(now: number, s: LateRules, shift?: ShiftTimes): { ok: true } | { ok: false; error: string } {
  const w = windows(s, shift);
  if (w?.checkoutBy != null && now > w.checkoutBy)
    return { ok: false, error: `Check-out closed at ${fmtTime(w.checkoutBy)}. You did not check out in time, so today counts as a half day.` };
  return { ok: true };
}

/**
 * Late rule alone: on time by the start; late up to the grace time = Present while fewer than `late_allowed_per_month`
 * were used this month (`lateUsed`), else Half day; after the grace time = Half day.
 */
export function checkInStatus(inMinutes: number, s: LateRules, lateUsed: number): InStatus {
  const w = windows(s);
  if (!w || inMinutes <= w.start) return 'on_time';
  if (inMinutes > w.grace) return 'half_day';
  return lateUsed < w.allowed ? 'late' : 'half_day';
}

/** The employee's short leave / half day on the day being checked in (approved, or still pending). */
export interface DayLeave { type: 'short' | 'half'; session: ShortSession | null; approved: boolean }

export type CheckInDecision =
  | { ok: true; status: InStatus; code: 'P' | 'H' | 'S'; message?: string }
  | { ok: false; error: string };

/**
 * What a check-in at `now` (minutes after midnight, IST) counts as, or why it is refused.
 *
 *  Normal day:   by start = Present · up to grace = Present (first N times a month) then Half day · up to close = Half day
 *                · closed until the second half · second half .. + extra = Half day · after that closed (the day is Absent)
 *  Morning short leave: check in by morning_short_back + extra (Short leave; Present while pending), else as a normal day
 *  Morning half day:    check in by second half + extra (Half day), else closed (Absent)
 *  Evening short leave / half day: normal morning rules; an approved one marks the day S / H.
 */
export function decideCheckIn(now: number, s: LateRules, lateUsed: number, leave?: DayLeave | null, shift?: ShiftTimes): CheckInDecision {
  const w = windows(s, shift);
  const morning = leave?.session === 'morning';
  const adjust = (code: 'P' | 'H' | 'S'): 'P' | 'H' | 'S' => {
    if (!leave?.approved || code === 'H') return code;
    return leave.type === 'half' ? 'H' : 'S';
  };
  if (!w) return { ok: true, status: 'on_time', code: adjust('P') };

  const closedForDay = { ok: false as const, error: `Check-in closed at ${fmtTime(w.deadline)}. Today is marked absent — talk to HR if this is wrong.` };
  const secondHalf = (why: string): CheckInDecision => (now < w.second
    ? { ok: false, error: `${why} You can check in from ${fmtTime(w.second)} to ${fmtTime(w.deadline)} for a half day.` }
    : now <= w.deadline
      ? { ok: true, status: 'half_day', code: 'H', message: `Second-half check-in: today is marked as a half day.` }
      : closedForDay);

  if (morning && leave!.type === 'half') {
    if (now > w.deadline) return closedForDay;
    return { ok: true, status: 'on_time', code: 'H', message: 'Checked in after your morning half day: today is a half day.' };
  }
  if (morning && leave!.type === 'short') {
    if (now <= w.shortUntil)
      return { ok: true, status: 'on_time', code: leave!.approved ? 'S' : 'P', message: leave!.approved ? 'Checked in after your morning short leave.' : undefined };
    return secondHalf(`Check-in after a morning short leave closed at ${fmtTime(w.shortUntil)}.`);
  }

  if (now <= w.start) return { ok: true, status: 'on_time', code: adjust('P') };
  if (now <= w.grace) {
    if (lateUsed < w.allowed)
      return { ok: true, status: 'late', code: adjust('P'), message: `Late check-in (after ${fmtTime(w.start)}). ${lateUsed + 1} of ${w.allowed} late check-ins allowed this month used.` };
    return { ok: true, status: 'half_day', code: 'H', message: `Late check-in: your ${w.allowed} late check-ins for this month are used, so today is marked as a half day.` };
  }
  if (now <= w.close) return { ok: true, status: 'half_day', code: 'H', message: `Late check-in after ${fmtTime(w.grace)}: today is marked as a half day.` };
  return secondHalf(`Morning check-in closed at ${fmtTime(w.close)}.`);
}
