export type EmailTemplateType = 'payslip' | 'payslip_portal_disabled' | 'payslip_offcycle' | 'payslip_fnf';

export interface EmailTemplate { type: EmailTemplateType; subject: string; body: string }

export const PLACEHOLDERS = [
  { key: 'CompanyName', label: 'Company name', sample: 'Derivion International Pvt Ltd' },
  { key: 'EmployeeName', label: 'Employee name', sample: 'Example Person' },
  { key: 'EmployeeID', label: 'Employee ID', sample: 'ISFTD0001' },
  { key: 'PayPeriodMonth', label: 'Pay period (month)', sample: 'October 2026' },
  { key: 'PayDate', label: 'Pay date', sample: '05 Nov 2026' },
  { key: 'NetPay', label: 'Net pay', sample: '₹ 25,000.00' },
  { key: 'LastWorkingDay', label: 'Last working day (final settlement)', sample: '31 Oct 2026' },
] as const;

export const TEMPLATE_META: { type: EmailTemplateType; title: string; note: string }[] = [
  { type: 'payslip', title: 'Payslip Notification', note: 'This email will be sent when you pay your employees.' },
  { type: 'payslip_portal_disabled', title: 'Payslip Notification (For Portal Disabled Employees Only)', note: 'Sent to employees who cannot use the portal; the payslip is attached.' },
  { type: 'payslip_offcycle', title: 'Off Cycle & One-Time Payrolls Payslip Notification', note: 'This email will be sent when you pay your employees through Off Cycle or One-Time Payrolls.' },
  { type: 'payslip_fnf', title: 'Full & Final Settlement Payslip Notification', note: "This email will be sent once you process the employee's final settlement." },
];

export const TEMPLATE_TYPES = TEMPLATE_META.map(t => t.type);

const sign = '<p style="color:#5b6070;font-size:13px">Cheers,<br>Team %CompanyName%</p>';

export const DEFAULT_TEMPLATES: Record<EmailTemplateType, { subject: string; body: string }> = {
  payslip: {
    subject: 'Payslip for the month of %PayPeriodMonth%',
    body: '<p><b>Hi %EmployeeName%,</b></p><p>Your payslip for <b>%PayPeriodMonth%</b> has been issued. Please find it attached to this email as a PDF.</p>' + sign,
  },
  payslip_portal_disabled: {
    subject: 'Payslip for the month of %PayPeriodMonth%',
    body: '<p><b>Hi %EmployeeName%,</b></p><p>Your payslip for <b>%PayPeriodMonth%</b> has been issued. Since you do not have portal access, it is attached to this email as a PDF.</p>' + sign,
  },
  payslip_offcycle: {
    subject: 'Off cycle payslip for %PayPeriodMonth%',
    body: '<p><b>Hi %EmployeeName%,</b></p><p>An off cycle / one-time payment has been processed for you in <b>%PayPeriodMonth%</b> on %PayDate%. Your payslip is attached to this email as a PDF.</p>' + sign,
  },
  payslip_fnf: {
    subject: 'Full & Final Settlement - %EmployeeName%',
    body: '<p><b>Hi %EmployeeName%,</b></p><p>Your full &amp; final settlement has been processed; your last working day with %CompanyName% was <b>%LastWorkingDay%</b>. Your payslips and relieving letter are attached to this email as PDFs.</p><p>We wish you all the best for the future.</p>' + sign,
  },
};

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Replaces %Placeholder% tokens. Unknown tokens are left as they are. `html` escapes the values for use inside the body. */
export function fillTemplate(text: string, vars: Record<string, string>, html: boolean): string {
  return text.replace(/%([A-Za-z]+)%/g, (whole, k: string) => (k in vars ? (html ? escapeHtml(vars[k]) : vars[k]) : whole));
}

/** Where emails point to the company logo; the mailer attaches the logo under this id (inline image). */
export const LOGO_CID = 'company-logo';

/**
 * The branded card around a template body (the editor preview uses the same markup).
 * `brand` = the company's settings (name + logo, so a new logo shows in every email at once) or just a name.
 * In emails the logo is referenced as cid:company-logo and attached by orgMail(); `inlineLogo` (browser preview)
 * uses the image directly.
 */
export function wrapEmail(bodyHtml: string, brand: string | { company_name: string; logo?: string | null }, opts: { inlineLogo?: boolean } = {}): string {
  const name = typeof brand === 'string' ? brand : brand.company_name;
  const logo = typeof brand === 'string' ? null : brand.logo ?? null;
  const img = logo && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(logo)
    ? `<img src="${opts.inlineLogo ? logo : `cid:${LOGO_CID}`}" alt="" height="40" style="height:40px;max-width:160px;vertical-align:middle;margin-right:12px;border:0">`
    : '';
  return `<div style="background:#eef8f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border-top:4px solid #8fe3c8;overflow:hidden">
<div style="padding:16px 28px;border-bottom:1px solid #e8ecf0;font-weight:bold;font-size:16px;color:#1c1f2b">${img}<span style="vertical-align:middle">${escapeHtml(name)}</span></div>
<div style="padding:24px 28px;color:#1c1f2b;font-size:14px;line-height:1.6">${bodyHtml}</div>
</div></div>`;
}

export const htmlToText = (h: string) =>
  h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();

/** Values for the placeholders that come from the company and employee records. */
export const baseVars = (company: string, emp: { name: string; emp_code: string }): Record<string, string> =>
  ({ CompanyName: company, EmployeeName: emp.name, EmployeeID: emp.emp_code });
