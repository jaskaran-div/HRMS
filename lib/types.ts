export type Role = 'admin' | 'editor' | 'viewer' | 'team_lead' | 'employee';

/** HR staff use the main app; team leaders and employees use /portal. */
export const STAFF_ROLES: Role[] = ['admin', 'editor', 'viewer'];
export const PORTAL_ROLES: Role[] = ['team_lead', 'employee'];
export const isStaff = (r: Role) => STAFF_ROLES.includes(r);

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  employee_id: string | null;
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
  sender_name: string | null;
  sender_email: string;
  reply_to: string | null;
  short_leave_per_month: number;
  hr_email: string | null;
}

export interface Employee {
  id: string;
  emp_code: string;
  name: string;
  department: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  exit_type: string | null;
  exit_remarks: string | null;
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
  team_lead_id: string | null;
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
  short_leave_days: number;
  weekoff_days: number;
  holiday_days: number;
  arrears: number;
  other_deduction: number;
  carry_cleared: boolean;
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
  'department', 'designation', 'email', 'phone', 'emergency_name', 'emergency_phone', 'location', 'manager',
  'bank_name', 'account_no', 'ifsc', 'pan', 'pf_no',
] as const;

export type LeaveType = 'short' | 'paid' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  emailed_at: string | null;
  emailed_to: string | null;
  created_at: string;
  /** What the employee asked for; leave_type is what it counts as (HR may approve paid leave as absent). */
  requested_type: LeaveType | null;
  /** Paid leave asked for beyond the monthly allowance: HR decides paid or absent. */
  over_quota: boolean;
  /** Team leader's step ('not_required' = no team leader login when the request was made). */
  tl_status: StepStatus | 'not_required';
  tl_by_name: string | null;
  tl_at: string | null;
  tl_note: string | null;
  /** HR's step. */
  hr_status: StepStatus;
  hr_by_name: string | null;
  hr_at: string | null;
  hr_note: string | null;
}

export type StepStatus = 'pending' | 'approved' | 'rejected';

export interface DocumentRow {
  id: string;
  employee_id: string | null;
  title: string;
  category: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  drive_file_id: string;
  visible_to_employee: boolean;
  uploaded_by_name: string | null;
  created_at: string;
}
