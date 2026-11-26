// The one subscription plan and the features it includes. SERVER + CLIENT safe: no keys here.
// The real charge is the Stripe price (STRIPE_PRICE_ID) when set; otherwise checkout charges PLAN below.

export type Feature =
  | 'employees' | 'attendance' | 'leave' | 'mobile' | 'notifications' | 'teams'
  | 'payroll' | 'documents' | 'email_center';

export const ALL_FEATURES: Feature[] = ['employees', 'attendance', 'leave', 'mobile', 'notifications', 'teams', 'payroll', 'documents', 'email_center'];

/** Features an organization may switch off for itself. Employees is the core of the HRMS and always stays on. */
export const OPTIONAL_FEATURES: Feature[] = ALL_FEATURES.filter(f => f !== 'employees');

export const FEATURE_LABEL: Record<Feature, string> = {
  employees: 'Employees', attendance: 'Attendance & check-in', leave: 'Leave', mobile: 'Mobile app', notifications: 'Notifications',
  teams: 'Teams & hierarchy', payroll: 'Payslips', documents: 'Documents', email_center: 'Email Center',
};

export const FEATURE_DESCRIPTION: Record<Feature, string> = {
  employees: 'Employee records, profiles, import from Excel.',
  attendance: 'Check-in from the app, the web portal, office location or office Wi-Fi; shifts and automatic absent.',
  leave: 'Leave requests, approvals, half days and leave balances.',
  mobile: 'The Android app for employees and team leaders.',
  notifications: 'Push and email notifications for approvals and reminders.',
  teams: 'Teams, team leaders and reporting lines.',
  payroll: 'Payslip PDFs for every employee, in the employee panel and the app.',
  documents: 'Company and employee documents, shared with each employee.',
  email_center: 'Email templates and one-off emails to employees with attachments.',
};

/** The single plan. amount is in paise (smallest currency unit), like Stripe. */
export const PLAN = {
  key: 'business',
  name: 'Business',
  amount: 249_900,
  currency: 'inr',
  interval: 'month' as const,
  tagline: 'Everything your HR team needs, for any number of employees.',
  highlights: [
    'Unlimited employees',
    'Unlimited HR and team leader logins',
    'Attendance, shifts and check-in from app, web, location or Wi-Fi',
    'Leave, half days and approvals',
    'Payslips for every employee (PDF)',
    'Documents and Email Center',
    'Android app for employees',
    'Switch any feature on or off yourself',
  ],
};

export const isFeature = (x: unknown): x is Feature => typeof x === 'string' && (ALL_FEATURES as string[]).includes(x);
