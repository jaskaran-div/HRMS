import type { SheetRow } from './sheet';
import { norm, num } from './format';
import { toISODate } from './dates';
import type { Employee } from './types';

type TextKey = 'name' | 'department' | 'designation' | 'email' | 'phone' | 'emergency_name' | 'emergency_phone' | 'location' | 'manager'
  | 'bank_name' | 'account_no' | 'ifsc' | 'pan' | 'pf_no';
type DateKey = 'doj' | 'dob';
type NumKey = 'monthly_salary' | 'pf_amount' | 'tds_amount';

const ID_ALIASES = ['employeeid', 'empid', 'empcode', 'employeecode', 'id', 'empno', 'employeeno', 'staffid', 'code'];

const ALIASES: Record<TextKey | DateKey | NumKey, string[]> = {
  name: ['name', 'employeename', 'empname', 'fullname'],
  department: ['department', 'dept'],
  designation: ['designation', 'position', 'role', 'jobtitle', 'title'],
  email: ['email', 'emailid', 'mail', 'officialemail'],
  phone: ['phone', 'mobile', 'contact', 'phoneno', 'mobileno', 'contactno'],
  emergency_name: ['emergencyname', 'emergencycontactname', 'emergencycontact', 'emergencyperson'],
  emergency_phone: ['emergencynumber', 'emergencyphone', 'emergencycontactnumber', 'emergencycontactno', 'emergencyphoneno', 'emergencymobile'],
  location: ['location', 'branch', 'office', 'workplace'],
  manager: ['manager', 'reportingmanager', 'reportsto'],
  bank_name: ['bank', 'bankname'],
  account_no: ['accountno', 'accountnumber', 'bankaccount', 'bankaccountno', 'acno'],
  ifsc: ['ifsc', 'ifsccode'],
  pan: ['pan', 'panno', 'pannumber'],
  pf_no: ['pfno', 'pfnumber', 'uan', 'uanno', 'pfaccount'],
  doj: ['dateofjoining', 'doj', 'joiningdate', 'joindate'],
  dob: ['dateofbirth', 'dob', 'birthdate'],
  monthly_salary: ['salary', 'monthlysalary', 'monthlygross', 'gross', 'grosssalary', 'monthlypay'],
  pf_amount: ['pf', 'providentfund', 'pfamount', 'pfdeduction'],
  tds_amount: ['tds', 'incometax', 'tax', 'tdsamount'],
};

const LOOKUP = new Map<string, TextKey | DateKey | NumKey | 'emp_code'>();
ID_ALIASES.forEach(a => LOOKUP.set(a, 'emp_code'));
(Object.entries(ALIASES) as [TextKey | DateKey | NumKey, string[]][]).forEach(([k, list]) =>
  list.forEach(a => LOOKUP.set(a, k)));

export type EmployeeFields = Partial<Pick<Employee, TextKey | DateKey | NumKey>>;

export interface ParsedEmployee {
  row: number;
  emp_code: string;
  fields: EmployeeFields;
  extra: Record<string, string>;
}

export interface ParsedEmployees {
  employees: ParsedEmployee[];
  warnings: string[];
  skipped: number;
  /** Columns we did not recognise; their values are kept under "extra details". */
  unmapped: string[];
}

export function parseEmployees(rows: SheetRow[]): ParsedEmployees {
  const byCode = new Map<string, ParsedEmployee>();
  const warnings: string[] = [];
  const unmapped = new Set<string>();
  let skipped = 0;

  rows.forEach((raw, idx) => {
    const fields: Record<string, string | number> = {};
    const extra: Record<string, string> = {};
    let code = '';
    for (const [header, value] of Object.entries(raw)) {
      if (value === '' || value == null) continue;
      const key = LOOKUP.get(norm(header));
      if (!key) {
        if (!header.startsWith('__col')) {
          unmapped.add(header);
          extra[header.replace(/__\d+$/, '')] = value instanceof Date ? (toISODate(value) ?? '') : String(value).trim();
        }
        continue;
      }
      if (key === 'emp_code') code = String(value).trim().toUpperCase();
      else if (key === 'doj' || key === 'dob') {
        const iso = toISODate(value);
        if (iso) fields[key] = iso;
        else warnings.push(`Row ${idx + 2}: could not read ${key === 'doj' ? 'joining' : 'birth'} date "${String(value)}"`);
      } else if (key === 'monthly_salary' || key === 'pf_amount' || key === 'tds_amount') fields[key] = num(value);
      else fields[key] = String(value).trim();
    }
    if (!code) { skipped++; return; }
    if (byCode.has(code)) warnings.push(`Employee ID ${code} appears more than once; the last row wins.`);
    byCode.set(code, { row: idx + 2, emp_code: code, fields: fields as EmployeeFields, extra });
  });

  return { employees: [...byCode.values()], warnings, skipped, unmapped: [...unmapped] };
}
