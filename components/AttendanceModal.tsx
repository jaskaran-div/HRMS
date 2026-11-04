'use client';

import { FormModal, type Field } from './Modal';
import { useApp } from './AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { daysInMonth, monthLabel, monthStart } from '@/lib/dates';
import { num } from '@/lib/format';
import type { Attendance, Employee } from '@/lib/types';

/** Add or correct one employee's attendance for one month. `month` null = let the user pick it. */
export function AttendanceModal({ emp, month, existing, onClose, onSaved }: {
  emp: Employee;
  month: string | null;
  existing?: Attendance;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useApp();
  const days = (cell: string, label: string, hint?: string): Field => ({ key: cell, label, type: 'number', hint });
  const fields: Field[] = [
    ...(month ? [] : [{ key: 'month', label: 'Month', type: 'month' as const, required: true }]),
    { key: 'salary', label: 'Monthly salary this month (₹)', type: 'number' },
    days('present_days', 'Present days'),
    days('half_days', 'Half days', 'Counted as ½ day each'),
    days('absent_days', 'Absent days', 'The monthly paid leave covers the first one'),
    days('leave_days', 'Paid leave already approved'),
    days('weekoff_days', 'Week offs'),
    days('holiday_days', 'Public holidays'),
    { key: 'arrears', label: 'Arrears (₹)', type: 'number', hint: 'Added to earnings' },
    { key: 'other_deduction', label: 'Other deductions (₹)', type: 'number' },
    {
      key: 'carry_cleared', label: 'Carry arrears / deductions to next month?', type: 'select', wide: true,
      options: [{ value: 'no', label: 'Yes — carry forward if the payslip was not generated' }, { value: 'yes', label: 'No — already cleared, do not carry forward' }],
    },
  ];
  const g = (k: keyof Attendance) => String(existing?.[k] ?? 0);
  const initial = {
    month: '',
    salary: String(existing?.salary ?? emp.monthly_salary ?? 0),
    present_days: g('present_days'), half_days: g('half_days'), absent_days: g('absent_days'), leave_days: g('leave_days'),
    weekoff_days: g('weekoff_days'), holiday_days: g('holiday_days'), arrears: g('arrears'), other_deduction: g('other_deduction'),
    carry_cleared: existing?.carry_cleared ? 'yes' : 'no',
  };

  return (
    <FormModal
      title={`Attendance — ${emp.name}${month ? ` · ${monthLabel(month)}` : ''}`}
      fields={fields} initial={initial} onClose={onClose}
      onSave={async v => {
        const m = month ?? (v.month ? monthStart(v.month) : '');
        if (!m) return 'Pick a month.';
        const [y, mo] = m.split('-').map(Number);
        const total = ['present_days', 'half_days', 'absent_days', 'leave_days', 'weekoff_days', 'holiday_days']
          .reduce((s, k) => s + num(v[k]), 0);
        if (total > daysInMonth(y, mo)) return `These add up to ${total} days, but ${monthLabel(m)} only has ${daysInMonth(y, mo)}.`;
        const { error } = await supabaseBrowser().from('attendance').upsert({
          employee_id: emp.id, month: m, salary: num(v.salary),
          present_days: num(v.present_days), half_days: num(v.half_days), absent_days: num(v.absent_days),
          leave_days: num(v.leave_days), weekoff_days: num(v.weekoff_days), holiday_days: num(v.holiday_days),
          arrears: num(v.arrears), other_deduction: num(v.other_deduction), carry_cleared: v.carry_cleared === 'yes', daily: null,
        }, { onConflict: 'employee_id,month' });
        if (error) return error.message;
        notify('Attendance saved');
        onSaved();
      }}
    />
  );
}
