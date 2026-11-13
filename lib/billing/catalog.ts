// What a subscription includes. SERVER + CLIENT safe: holds no keys, only feature names and which
// environment variable holds each Stripe price id (the ids themselves are read on the server).

export type Feature =
  | 'employees' | 'attendance' | 'leave' | 'mobile' | 'notifications' | 'teams'   // base plan
  | 'payroll' | 'documents' | 'email_center';                                      // add-ons

/** Included in the base subscription (STRIPE_BASE_PRICE_ID). */
export const BASE_FEATURES: Feature[] = ['employees', 'attendance', 'leave', 'mobile', 'notifications', 'teams'];

export interface AddonDef {
  feature: Feature;
  name: string;
  description: string;
  /** server environment variable holding the Stripe price id; the add-on is offered only when it is set */
  priceEnv: string;
}

export const ADDONS: AddonDef[] = [
  { feature: 'payroll', name: 'Payroll & Payslips', description: 'Salary calculation from attendance, payslip PDFs, payslips in the employee panel and the app, payslip emails.', priceEnv: 'STRIPE_ADDON_PAYROLL_PRICE_ID' },
  { feature: 'documents', name: 'Documents', description: 'Company and employee documents stored in Google Drive, shared with each employee.', priceEnv: 'STRIPE_ADDON_DOCUMENTS_PRICE_ID' },
  { feature: 'email_center', name: 'Email Center', description: 'Custom email templates and one-off emails to employees with attachments.', priceEnv: 'STRIPE_ADDON_EMAIL_PRICE_ID' },
];

export const ALL_FEATURES: Feature[] = [...BASE_FEATURES, ...ADDONS.map(a => a.feature)];

export const FEATURE_LABEL: Record<Feature, string> = {
  employees: 'Employees', attendance: 'Attendance & check-in', leave: 'Leave', mobile: 'Mobile app', notifications: 'Notifications',
  teams: 'Teams & hierarchy', payroll: 'Payroll & Payslips', documents: 'Documents', email_center: 'Email Center',
};

export const isFeature = (x: unknown): x is Feature => typeof x === 'string' && (ALL_FEATURES as string[]).includes(x);
