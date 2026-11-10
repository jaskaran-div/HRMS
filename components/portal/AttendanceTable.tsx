import { monthLabel } from '@/lib/dates';
import type { Attendance } from '@/lib/types';

export type AttendanceSummary = Pick<Attendance, 'month' | 'present_days' | 'half_days' | 'absent_days' | 'leave_days' | 'short_leave_days' | 'weekoff_days' | 'holiday_days'>;
export const ATTENDANCE_COLUMNS = 'month, present_days, half_days, absent_days, leave_days, short_leave_days, weekoff_days, holiday_days';

/** Month-by-month attendance counts (no salary figures). */
export function AttendanceTable({ rows }: { rows: AttendanceSummary[] }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Month</th><th className="n">Present</th><th className="n">Half day</th><th className="n">Absent</th><th className="n">Paid leave</th><th className="n">Short leave</th><th className="n">Week off</th><th className="n">Holiday</th></tr></thead>
        <tbody>
          {rows.map(a => (
            <tr key={a.month}>
              <td><b>{monthLabel(a.month)}</b></td><td className="n">{a.present_days}</td><td className="n">{a.half_days}</td><td className="n">{a.absent_days}</td>
              <td className="n">{a.leave_days}</td><td className="n">{a.short_leave_days ?? 0}</td><td className="n">{a.weekoff_days}</td><td className="n">{a.holiday_days}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 26 }}>No attendance recorded yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
