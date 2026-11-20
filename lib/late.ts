import type { Settings } from './types';

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

/** 'HH:MM' (24h) -> '10:30 AM'. */
export function fmtTime(t: string | null | undefined): string {
  const v = toMinutes(t);
  if (v == null) return '—';
  const h = Math.floor(v / 60), m = v % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

type LateRules = Pick<Settings, 'office_start_time' | 'late_grace_until' | 'late_allowed_per_month'>;

/**
 * What a check-in at `inMinutes` counts as.
 * - on or before the office start time: on time (Present)
 * - after it, up to the grace time: late — Present while fewer than `late_allowed_per_month` late check-ins were used
 *   this month (`lateUsed`), otherwise Half day
 * - after the grace time: Half day
 * No office start time set = every check-in is on time.
 */
export function checkInStatus(inMinutes: number, s: LateRules, lateUsed: number): InStatus {
  const start = toMinutes(s.office_start_time);
  if (start == null || inMinutes <= start) return 'on_time';
  const grace = Math.max(start, toMinutes(s.late_grace_until) ?? start);
  if (inMinutes > grace) return 'half_day';
  return lateUsed < Number(s.late_allowed_per_month ?? 3) ? 'late' : 'half_day';
}
