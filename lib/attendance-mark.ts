import { supabaseAdmin } from './supabase/admin';
import { daysInMonth, isOffSaturday } from './dates';

type CountKey = 'present_days' | 'absent_days' | 'weekoff_days' | 'half_days' | 'leave_days' | 'holiday_days' | 'short_leave_days';
const KEY_OF: Record<string, CountKey> = {
  P: 'present_days', A: 'absent_days', W: 'weekoff_days', H: 'half_days', L: 'leave_days', O: 'holiday_days', S: 'short_leave_days',
};

/**
 * Marks one day (YYYY-MM-DD) in the employee's monthly attendance, in the same shape the HR grid saves, unless HR
 * already marked that day (or entered the month as totals only). Unmarked 2nd / 4th Saturdays are filled as week offs,
 * exactly as the grid does on save, so the totals match. Returns whether the day was marked.
 */
export function markDay(employeeId: string, doj: string | null, salary: number, day: string, code: 'P' | 'H' | 'S' | 'A'): Promise<boolean> {
  return writeDay(employeeId, doj, salary, day, code, cur => !cur);
}

/**
 * Checked in but did not check out in time: the day becomes a Half day — only when it is still what a check-in marks
 * (Present / Short leave). Anything HR set by hand stays.
 */
export function downgradeToHalf(employeeId: string, doj: string | null, salary: number, day: string): Promise<boolean> {
  return writeDay(employeeId, doj, salary, day, 'H', cur => cur === 'P' || cur === 'S');
}

async function writeDay(
  employeeId: string, doj: string | null, salary: number, day: string, code: string, may: (cur: string | undefined) => boolean,
): Promise<boolean> {
  const admin = supabaseAdmin();
  const month = `${day.slice(0, 7)}-01`;
  const [y, m] = month.split('-').map(Number);
  const d = Number(day.slice(8, 10));
  const last = `${month.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, '0')}`;
  // the month's row and its approved half-day leave are independent: read both in one round trip
  const [{ data: row }, { data: halves }] = await Promise.all([
    admin.from('attendance').select('*').eq('employee_id', employeeId).eq('month', month).maybeSingle(),
    // half days that are approved half-day leave (paid within the monthly half-day allowance)
    admin.from('leave_requests').select('start_date').eq('employee_id', employeeId)
      .eq('leave_type', 'half').eq('status', 'approved').gte('start_date', month).lte('start_date', last),
  ]);
  if (row && !row.daily) return false; // HR entered this month as totals only: leave it to HR
  const daily: Record<string, string> = { ...((row?.daily as Record<string, string> | null) ?? {}) };
  if (!may(daily[String(d)])) return false;
  daily[String(d)] = code;
  let first = 1;
  if (doj) {
    const [jy, jm, jd] = doj.split('-').map(Number);
    if (jy === y && jm === m) first = jd;
  }
  for (let i = first; i <= daysInMonth(y, m); i++) if (!daily[String(i)] && isOffSaturday(y, m, i)) daily[String(i)] = 'W';
  const counts: Record<CountKey, number> = { present_days: 0, absent_days: 0, weekoff_days: 0, half_days: 0, leave_days: 0, holiday_days: 0, short_leave_days: 0 };
  for (const c of Object.values(daily)) if (KEY_OF[c]) counts[KEY_OF[c]]++;

  const halfDays = new Set((halves ?? []).map(h => String(Number(String(h.start_date).slice(8, 10)))));
  const half_leave_days = Object.entries(daily).filter(([k, v]) => v === 'H' && halfDays.has(k)).length;

  const { error } = await admin.from('attendance').upsert({
    employee_id: employeeId, month, salary: Number(row?.salary) || salary || 0,
    arrears: row?.arrears ?? 0, other_deduction: row?.other_deduction ?? 0, ...counts, half_leave_days, daily,
  }, { onConflict: 'employee_id,month' });
  return !error;
}
