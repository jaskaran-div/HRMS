import type { Field, Values } from '@/components/Modal';
import type { Employee, Shift } from './types';
import { fmtTime } from './late';
import { num } from './format';

export const EMPLOYEE_FIELDS: Field[] = [
  { key: 'emp_code', label: 'Employee ID', required: true },
  { key: 'name', label: 'Full name', required: true },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'email', label: 'Official email', type: 'email' },
  { key: 'phone', label: 'Phone' },
  { key: 'emergency_name', label: 'Emergency contact name' },
  { key: 'emergency_phone', label: 'Emergency contact number' },
  { key: 'doj', label: 'Date of joining', type: 'date' },
  { key: 'dob', label: 'Date of birth', type: 'date' },
  { key: 'location', label: 'Location' },
  { key: 'manager', label: 'Reporting manager' },
  { key: 'bank_name', label: 'Bank name' },
  { key: 'account_no', label: 'Account number' },
  { key: 'ifsc', label: 'IFSC' },
  { key: 'pan', label: 'PAN' },
  { key: 'pf_no', label: 'PF / UAN number' },
  { key: 'monthly_salary', label: 'Monthly salary (₹)', type: 'number', hint: 'Full month, before any unpaid days' },
  { key: 'pf_amount', label: 'Provident Fund / month (₹)', type: 'number' },
  { key: 'tds_amount', label: 'Income tax / month (₹)', type: 'number' },
];

/** The "Shift" dropdown: the shifts HR made under Company & Rules → Shifts, or the office timing. */
export function shiftField(shifts: Pick<Shift, 'id' | 'name' | 'start_time' | 'end_time'>[]): Field {
  return {
    key: 'shift_id', label: 'Shift', type: 'select',
    options: [
      { value: '', label: 'Office timing (no shift)' },
      ...shifts.map(s => ({ value: s.id, label: `${s.name} · ${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}` })),
    ],
    hint: 'Check-in / check-out times follow this shift. Shifts are made under Company & Rules.',
  };
}

/** The employee form with the Shift dropdown after Designation. */
export function employeeFields(shifts: Pick<Shift, 'id' | 'name' | 'start_time' | 'end_time'>[]): Field[] {
  const i = EMPLOYEE_FIELDS.findIndex(f => f.key === 'designation') + 1;
  return [...EMPLOYEE_FIELDS.slice(0, i), shiftField(shifts), ...EMPLOYEE_FIELDS.slice(i)];
}

const TEXT_KEYS = ['department', 'designation', 'email', 'phone', 'emergency_name', 'emergency_phone', 'location', 'manager', 'bank_name', 'account_no', 'ifsc', 'pan', 'pf_no'] as const;

export function employeeToValues(e?: Employee): Values {
  const v: Values = {};
  for (const f of EMPLOYEE_FIELDS) {
    const raw = e ? (e as unknown as Record<string, unknown>)[f.key] : '';
    v[f.key] = raw === null || raw === undefined ? '' : String(raw);
  }
  v.shift_id = e?.shift_id ?? '';
  if (e) for (const [k, x] of Object.entries(e.extra ?? {})) v['x:' + k] = x;
  return v;
}

/** Form values -> columns to save. Empty text becomes null. */
export function valuesToEmployee(v: Values): Omit<Employee, 'id' | 'archived_at' | 'team_lead_id'> {
  const out: Record<string, unknown> = {
    emp_code: v.emp_code.toUpperCase(),
    name: v.name,
    doj: v.doj || null,
    dob: v.dob || null,
    monthly_salary: num(v.monthly_salary),
    pf_amount: num(v.pf_amount),
    tds_amount: num(v.tds_amount),
  };
  for (const k of TEXT_KEYS) out[k] = v[k] || null;
  if ('shift_id' in v) out.shift_id = v.shift_id || null; // only when the form had the Shift dropdown
  const extra: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (k.startsWith('x:') && x) extra[k.slice(2)] = x;
  out.extra = extra;
  return out as unknown as Omit<Employee, 'id' | 'archived_at' | 'team_lead_id'>;
}
