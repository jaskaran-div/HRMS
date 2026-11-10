import { portalSession } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AttendanceTable, ATTENDANCE_COLUMNS, type AttendanceSummary } from '@/components/portal/AttendanceTable';

export const dynamic = 'force-dynamic';

export default async function MyAttendance() {
  const s = await portalSession();
  const { data } = await supabaseAdmin().from('attendance').select(ATTENDANCE_COLUMNS).eq('employee_id', s.me!.id)
    .order('month', { ascending: false }).limit(24);
  return (
    <div className="card">
      <h3>My attendance</h3>
      <AttendanceTable rows={(data ?? []) as AttendanceSummary[]} />
    </div>
  );
}
