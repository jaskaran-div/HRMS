import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from './fetch-all';
import { shiftMonth } from './dates';
import { carryFrom, type Carry, type PayRules } from './payroll';
import type { Attendance, Employee } from './types';

/** Amounts brought forward into `month` (YYYY-MM-01), keyed by employee id. */
export async function loadCarry(
  sb: SupabaseClient, month: string, emps: Employee[], rules: PayRules,
): Promise<Map<string, Carry>> {
  const prevMonth = shiftMonth(month, -1);
  const [prevAtt, slipMonths, prevSlips] = await Promise.all([
    fetchAll<Attendance>((a, b) => sb.from('attendance').select('*').eq('month', prevMonth).range(a, b)),
    fetchAll<{ month: string }>((a, b) => sb.from('payslips').select('month').range(a, b)),
    fetchAll<{ employee_id: string }>((a, b) => sb.from('payslips').select('employee_id').eq('month', prevMonth).range(a, b)),
  ]);
  const oldestKept = slipMonths.reduce<string | null>((o, x) => (o === null || x.month < o ? x.month : o), null);
  const purged = oldestKept !== null && prevMonth < oldestKept;
  const attBy = new Map(prevAtt.map(a => [a.employee_id, a]));
  const slipped = new Set(prevSlips.map(s => s.employee_id));
  return new Map(emps.map(e => [e.id, carryFrom(e, attBy.get(e.id), purged || slipped.has(e.id), rules)]));
}
