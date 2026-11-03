export type Role = 'admin' | 'editor' | 'viewer';

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface Settings {
  id: 1;
  company_name: string;
  company_address: string;
  logo: string | null;
  footer_note: string;
  paid_leave_per_month: number;
  basic_pct: number;
  hra_pct: number;
  conveyance_pct: number;
}

export interface Employee {
  id: string;
  emp_code: string;
  name: string;
  department: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  doj: string | null;
  dob: string | null;
  location: string | null;
  manager: string | null;
  bank_name: string | null;
  account_no: string | null;
  ifsc: string | null;
  pan: string | null;
  pf_no: string | null;
  monthly_salary: number;
  pf_amount: number;
  tds_amount: number;
  extra: Record<string, string>;
  archived_at: string | null;
}

export interface Attendance {
  id: string;
  employee_id: string;
  month: string; // YYYY-MM-01
  salary: number;
  present_days: number;
  half_days: number;
  absent_days: number;
  leave_days: number;
  weekoff_days: number;
  holiday_days: number;
  arrears: number;
  other_deduction: number;
  daily: Record<string, string> | null;
}

export interface PayLine {
  label: string;
  amount: number;
}

/** Everything needed to print a payslip (company details are added at print time). */
export interface PayslipData {
  employee: { code: string; name: string };
  month: string; // YYYY-MM-01
  payDate: string; // YYYY-MM-DD
  daysInMonth: number;
  paidDays: number;
  lopDays: number;
  earnings: PayLine[];
  deductions: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
}

export interface PayslipRow {
  id: string;
  employee_id: string;
  month: string;
  pay_date: string;
  net_pay: number;
  data: PayslipData;
  generated_at: string;
}

export interface RelievingLetterData {
  employee: { code: string; name: string; designation: string | null; department: string | null };
  doj: string | null;
  relievedOn: string; // YYYY-MM-DD, last working day
  issueDate: string; // YYYY-MM-DD
}

export interface ExitRecord {
  employee_id: string;
  relieved_on: string;
  payslip_months: 3 | 6;
  letter: RelievingLetterData;
  payslips: PayslipData[];
  created_at: string;
}

export const EMPLOYEE_TEXT_FIELDS = [
  'department', 'designation', 'email', 'phone', 'location', 'manager',
  'bank_name', 'account_no', 'ifsc', 'pan', 'pf_no',
] as const;
