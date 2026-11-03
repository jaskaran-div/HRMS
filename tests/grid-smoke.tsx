import { renderToString } from 'react-dom/server';
import { AppProvider } from '../components/AppContext';
import { AttendanceGrid } from '../components/AttendanceGrid';
import type { Attendance, Employee, Profile, Settings } from '../lib/types';

const settings = { id: 1, company_name: 'X', company_address: '', logo: null, footer_note: '', paid_leave_per_month: 1, basic_pct: 50, hra_pct: 25, conveyance_pct: 10 } as Settings;
const profile = { id: 'u', username: 'hr', full_name: 'HR', role: 'admin', active: true, must_change_password: false, created_at: '' } as Profile;
const emp = (id: string, code: string, name: string, salary: number, doj: string | null): Employee =>
  ({ id, emp_code: code, name, monthly_salary: salary, pf_amount: 0, tds_amount: 0, doj, extra: {}, archived_at: null } as unknown as Employee);
const emps = [emp('1', 'E1', 'Fabi Khan', 35000, null), emp('2', 'E2', 'Shreya Vyas', 20000, '2026-02-13')];
const daily: Record<string, string> = {};
for (let d = 1; d <= 28; d++) daily[d] = [1, 7, 14, 15, 22, 28].includes(d) ? 'W' : d === 8 ? 'H' : 'P';
const att = [{ id: 'a1', employee_id: '1', month: '2026-02-01', salary: 35000, present_days: 21, half_days: 1, absent_days: 0, leave_days: 0, weekoff_days: 6, holiday_days: 0, arrears: 0, other_deduction: 0, daily } as Attendance];

const html = renderToString(
  <AppProvider profile={profile} settings={settings}>
    <AttendanceGrid month="2026-02-01" emps={emps} att={att} carry={new Map()} readOnly={false} onSaved={() => {}} />
  </AppProvider>);
const must = (label: string, ok: boolean) => { console.log(ok ? '  ok  ' : '  FAIL', label); if (!ok) process.exitCode = 1; };
must('renders both employees', html.includes('Fabi Khan') && html.includes('Shreya Vyas'));
must('28 day headers (last is 28)', html.includes('>28<'));
must('Fabi net = 34,375 (27.5 paid days of 28)', html.includes('₹34,375'));
must('days before joining (1-12) are greyed for Shreya', (html.match(/cell off/g) ?? []).length === 12);
must('Shreya (no marks yet) is paid only the auto 2nd/4th Saturday week offs, 14 & 28 Feb', html.includes('₹1,429'));
