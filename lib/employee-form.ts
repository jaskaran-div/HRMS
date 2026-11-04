import type { Field, Values } from '@/components/Modal';
import type { Employee } from './types';
import { num } from './format';

export const EMPLOYEE_FIELDS: Field[] = [
  { key: 'emp_code', label: 'Employee ID', required: true },
  { key: 'name', label: 'Full name', required: true },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'email', label: 'Email', type: 'email' },
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

const TEXT_KEYS = ['department', 'designation', 'email', 'phone', 'emergency_name', 'emergency_phone', 'location', 'manager', 'bank_name', 'account_no', 'ifsc', 'pan', 'pf_no'] as const;

export function employeeToValues(e?: Employee): Values {
  const v: Values = {};
  for (const f of EMPLOYEE_FIELDS) {
    const raw = e ? (e as unknown as Record<string, unknown>)[f.key] : '';
    v[f.key] = raw === null || raw === undefined ? '' : String(raw);
  }
  if (e) for (const [k, x] of Object.entries(e.extra ?? {})) v['x:' + k] = x;
  return v;
}

/** Form values -> columns to save. Empty text becomes null. */
export function valuesToEmployee(v: Values): Omit<Employee, 'id' | 'archived_at'> {
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
  const extra: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (k.startsWith('x:') && x) extra[k.slice(2)] = x;
  out.extra = extra;
  return out as unknown as Omit<Employee, 'id' | 'archived_at'>;
}
