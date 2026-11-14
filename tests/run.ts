import { officialEmailOf } from '../lib/official-email';
import assert from 'node:assert/strict';
import { parseAttendance } from '../lib/parse-attendance';
import { parseEmployees } from '../lib/parse-employees';
import { computePay, type PayRules } from '../lib/payroll';
import { amountInWords } from '../lib/format';
import { daysInMonth, isOffSaturday, toISODate, toMonthStart } from '../lib/dates';
import * as XLSX from 'xlsx';
import { rowsFromWorkbook, type SheetRow } from '../lib/sheet';
import { availableTypes, canDecideStep, decidedBy, overallStatus, quotaFor, stageText, validateLeave, workingDays } from '../lib/leave';
import { employedIn } from '../lib/exit';
import { countDays, monthDays } from '../lib/att-view';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.error('  FAIL', name, '\n', e); process.exitCode = 1; }
};

// ---- the HR's February attendance sheet, day by day (P present, A absent, W week off, H half day, '' blank)
const feb = (s: string) => s.split(' ').map(x => (x === '-' ? '' : x));
const WORD: Record<string, string> = { P: 'Present', A: 'Absent', W: 'Week Off', H: 'Half Day', '': '' };
const people: [string, string, number, string, number][] = [
  ['Nikhil Rastogi', 'Business Development', 80000,
    'W P P P P P P W P P - - - - - - - - - - - - - - - - - -', 28571],
  ['Fabi Khan', 'Business Development', 35000,
    'W P P P P P W H P P P P P W W P P P P P P W P P P P P W', 34375],
  ['Pawan R', 'Business Development', 25000,
    'W P P P P P W P P P P P P W W P P P P P P W P P P P P W', 25000],
  ['Bhumika Khokhar', 'Business Development', 25000,
    'W P A A A A A W P P P P P W W P P P P P P W P P P P P W', 20536],
  ['Siddhant Pathak', 'Business Development', 25000,
    'W P P A P P P P P P P P P W W P P P P P P W P P P P P W', 24107],
  ['Priyanka Manral', 'Business Development', 20000,
    '- - - - - - - - - - - - - - - - - - - - - - - - P P P W', 2857],
  ['Roshnee Singh', 'Business Development', 25000,
    '- - - - - - - - - - - - - - - - - - - - - - - P P P P W', 4464],
  ['Shreya Vyas', 'Human Resources', 20000,
    '- - - - - - - - - - - - P P W P P P P P W W P P P P P W', 11429],
];

const header = (d: number) => `${d}-Feb`;
const sheet: SheetRow[] = people.map(([name, dept, salary, days]) => {
  const cells = feb(days);
  assert.equal(cells.length, 28, `${name}: expected 28 day cells, got ${cells.length}`);
  const row: SheetRow = { 'Employee Name': name, Salary: salary, Arrears: 0, Deduction: 0, Department: dept };
  cells.forEach((c, i) => { row[header(i + 1)] = WORD[c]; });
  return row;
});

const rules = (paidLeave: number): PayRules => ({ paidLeavePerMonth: paidLeave, shortLeavePerMonth: 1, basicPct: 50, hraPct: 25, conveyancePct: 10 });

console.log('Attendance sheet (Feb 2026, 28 days)');
const parsed = parseAttendance(sheet, 2026, 2);

test('detects all 28 day columns, daily mode', () => {
  assert.equal(parsed.dayColumns, 28);
  assert.equal(parsed.rows.length, 8);
  assert.ok(parsed.rows.every(r => r.source === 'daily'));
});

test('counts match the sheet summary columns (Present / Unpaid / Half / Sunday week-off)', () => {
  const want: Record<string, [number, number, number, number]> = {
    'Nikhil Rastogi': [8, 0, 0, 2], 'Fabi Khan': [21, 0, 1, 6], 'Pawan R': [22, 0, 0, 6], 'Bhumika Khokhar': [17, 5, 0, 6],
    'Siddhant Pathak': [22, 1, 0, 5], 'Priyanka Manral': [3, 0, 0, 1], 'Roshnee Singh': [4, 0, 0, 1], 'Shreya Vyas': [12, 0, 0, 4],
  };
  for (const r of parsed.rows) {
    const [p, a, h, w] = want[r.name];
    assert.deepEqual([r.counts.present, r.counts.absent, r.counts.half, r.counts.weekoff], [p, a, h, w], r.name);
  }
});

test('with 0 paid leave, salary equals the sheet\'s "To be paid" for every employee', () => {
  for (const r of parsed.rows) {
    const p = people.find(x => x[0] === r.name)!;
    const pay = computePay({ salary: r.salary!, arrears: 0, otherDeduction: 0, pf: 0, tds: 0, att: r.counts, daysInMonth: 28 }, rules(0));
    assert.equal(pay.gross, p[4], `${r.name}: ${pay.gross} vs ${p[4]}`);
  }
});

test('with 1 paid leave, only employees with absences change (Bhumika, Siddhant)', () => {
  const changed: string[] = [];
  for (const r of parsed.rows) {
    const p = people.find(x => x[0] === r.name)!;
    const pay = computePay({ salary: r.salary!, arrears: 0, otherDeduction: 0, pf: 0, tds: 0, att: r.counts, daysInMonth: 28 }, rules(1));
    if (pay.gross !== p[4]) changed.push(`${r.name}: ${p[4]} -> ${pay.gross}`);
  }
  assert.deepEqual(changed, ['Bhumika Khokhar: 20536 -> 21429', 'Siddhant Pathak: 24107 -> 25000']);
});

test('summary-columns fallback (no day columns) gives the same counts', () => {
  const rows: SheetRow[] = [{ 'Employee Name': 'Fabi Khan', Salary: 35000, 'Present Days': 21, 'Unpaid Days': 0, 'Half Day': 1, 'Paid Leave Days': 0, 'Sunday Weekoff': 6, 'Total Paid Days': 27.5 }];
  const r = parseAttendance(rows, 2026, 2).rows[0];
  assert.equal(r.source, 'summary');
  assert.deepEqual(r.counts, { present: 21, half: 1, absent: 0, leave: 0, weekoff: 6, holiday: 0, short: 0 });
});

test('wrong month picked -> day columns are ignored with a warning', () => {
  const p = parseAttendance(sheet, 2026, 3);
  assert.equal(p.dayColumns, 0);
  assert.ok(p.warnings.some(w => w.includes('another month')));
});

console.log('Payslip (July 2026, 31 days)');
test('reproduces the Zoho payslip: 30 paid days, 1 LOP, net 22,344', () => {
  const pay = computePay({
    salary: 20333, arrears: 2667, otherDeduction: 0, pf: 0, tds: 0,
    att: { present: 24, half: 0, absent: 1, leave: 0, weekoff: 6, holiday: 0 }, daysInMonth: daysInMonth(2026, 7),
  }, rules(0));
  assert.equal(pay.paidDays, 30);
  assert.equal(pay.lopDays, 1);
  assert.deepEqual(pay.earnings.map(e => e.amount), [9839, 4919, 1968, 2951, 2667]);
  assert.equal(pay.gross, 22344);
  assert.equal(pay.totalDeductions, 0);
  assert.equal(pay.net, 22344);
});

test('amount in words matches the payslip', () => {
  assert.equal(amountInWords(22344), 'Indian Rupee Twenty-Two Thousand Three Hundred Forty-Four Only');
  assert.equal(amountInWords(125000), 'Indian Rupee One Lakh Twenty-Five Thousand Only');
});

console.log('Employee sheet + dates');
test('employee master: aliases, dates, salary, unknown columns kept as extra', () => {
  const rows: SheetRow[] = [
    { 'Emp ID': 'isftd0007', 'Employee Name': 'Nidhi Singh', Dept: 'HR', 'Date of Joining': '12/04/2021', Salary: '₹20,333', 'Blood Group': 'B+', 'Bank Name': 'HDFC' },
    { 'Emp ID': '', 'Employee Name': 'No Id' },
  ];
  const p = parseEmployees(rows);
  assert.equal(p.employees.length, 1);
  assert.equal(p.skipped, 1);
  const e = p.employees[0];
  assert.equal(e.emp_code, 'ISFTD0007');
  assert.equal(e.fields.doj, '2021-04-12');
  assert.equal(e.fields.monthly_salary, 20333);
  assert.equal(e.fields.department, 'HR');
  assert.deepEqual(e.extra, { 'Blood Group': 'B+' });
});

test('date helpers', () => {
  assert.equal(toISODate('12 Apr 2021'), '2021-04-12');
  assert.equal(toISODate('31/12/2020'), '2020-12-31');
  assert.equal(toISODate(new Date(2021, 3, 12)), '2021-04-12');
  assert.equal(toISODate(44298), '2021-04-12');
  assert.equal(toMonthStart('Jul 2026'), '2026-07-01');
  assert.equal(toMonthStart('2026-07'), '2026-07-01');
});

console.log('Real .xlsx file round-trip');
test('title row above the header is skipped; "1-Feb" headers, blanks and Date cells read correctly', () => {
  const aoa: unknown[][] = [
    ['Attendance — February 2026', '', '', ''],
    [],
    ['Employee Name', 'Salary', 'Arrears', 'Deduction', ...Array.from({ length: 28 }, (_, i) => `${i + 1}-Feb`), 'Present Days'],
    ['Pawan R', 25000, 0, 0, ...Array.from({ length: 28 }, (_, i) => ([0, 6, 13, 14, 21, 27].includes(i) ? 'Week Off' : 'Present')), 22],
    ['Priyanka Manral', 20000, 0, 0, ...Array.from({ length: 28 }, (_, i) => (i >= 24 ? (i === 27 ? 'Week Off' : 'Present') : '')), 3],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Feb');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const rows = rowsFromWorkbook(XLSX.read(bytes, { type: 'buffer', cellDates: true }));
  assert.equal(rows.length, 2);
  const p = parseAttendance(rows, 2026, 2);
  assert.equal(p.dayColumns, 28);
  assert.deepEqual(p.rows.map(r => [r.name, r.counts.present, r.counts.weekoff]), [['Pawan R', 22, 6], ['Priyanka Manral', 3, 1]]);
  const pay = computePay({ salary: 20000, arrears: 0, otherDeduction: 0, pf: 0, tds: 0, att: p.rows[1].counts, daysInMonth: 28 }, rules(1));
  assert.equal(pay.gross, 2857);
});

test('employee .xlsx with real date cells', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Employee ID', 'Name', 'Date of Joining', 'Salary'],
    ['ISFTD0007', 'Nidhi Singh', new Date(2025, 5, 2), 20333],
  ], { cellDates: true }), 'E');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const e = parseEmployees(rowsFromWorkbook(XLSX.read(bytes, { type: 'buffer', cellDates: true }))).employees[0];
  assert.equal(e.fields.doj, '2025-06-02');
  assert.equal(e.fields.monthly_salary, 20333);
});

test('2nd and 4th Saturday are week offs', () => {
  // Feb 2026 Saturdays: 7, 14, 21, 28 -> 14 and 28 are off
  const off = Array.from({ length: 28 }, (_, i) => i + 1).filter(d => isOffSaturday(2026, 2, d));
  assert.deepEqual(off, [14, 28]);
  // Nov 2026 Saturdays: 7, 14, 21, 28
  assert.deepEqual(Array.from({ length: 30 }, (_, i) => i + 1).filter(d => isOffSaturday(2026, 11, d)), [14, 28]);
});

test('brought-forward arrears and deductions flow into the pay', () => {
  const base = { salary: 30000, arrears: 0, otherDeduction: 0, pf: 0, tds: 0, att: { present: 30, half: 0, absent: 0, leave: 0, weekoff: 0, holiday: 0 }, daysInMonth: 30 };
  const p = computePay({ ...base, carry: { arrears: 1000, deduction: 400 } }, rules(0));
  assert.equal(p.gross, 31000);
  assert.equal(p.totalDeductions, 400);
  assert.equal(p.net, 30600);
});



// ---- leave rules: 1 short + 1 paid leave per month, then only absent (unpaid)

const Q = { short_leave_per_month: 1, paid_leave_per_month: 1 };

const L = (id: string, leave_type: 'short' | 'paid' | 'unpaid', start_date: string, end_date = start_date, status: 'pending' | 'approved' | 'rejected' | 'cancelled' = 'approved', days = 1) =>

  ({ id, leave_type, start_date, end_date, status, days });



test('leave: working days skip Sundays and 2nd / 4th Saturdays', () => {

  assert.equal(workingDays('2026-11-09', '2026-11-15'), 5); // Mon-Sun, Sat 14th is the 2nd Saturday

  assert.equal(workingDays('2026-11-07', '2026-11-07'), 1); // 1st Saturday is a working day

});



test('leave: quota per month; used short / paid leave is no longer offered', () => {

  assert.deepEqual(availableTypes(quotaFor([], '2026-11-01', Q)), ['short', 'paid', 'unpaid']);

  const used = [L('a', 'short', '2026-11-03'), L('b', 'paid', '2026-11-05')];

  assert.deepEqual(availableTypes(quotaFor(used, '2026-11-01', Q)), ['paid', 'unpaid']); // short gone; paid still requestable (over the limit)

  assert.deepEqual(availableTypes(quotaFor(used, '2026-12-01', Q)), ['short', 'paid', 'unpaid']); // new month, fresh quota

  // rejected / cancelled requests give the quota back

  assert.deepEqual(availableTypes(quotaFor([L('a', 'paid', '2026-11-05', undefined, 'rejected')], '2026-11-01', Q)), ['short', 'paid', 'unpaid']);

});



test('leave: short / paid leave HR marked in the attendance calendar uses up the allowance', () => {
  const nov = (daily: Record<string, string>) => [{ month: '2026-11-01', daily }];
  let q = quotaFor([], '2026-11-01', Q, undefined, nov({ '3': 'S', '5': 'L', '6': 'P' }));
  assert.equal(q.shortLeft, 0); assert.equal(q.paidLeft, 0);
  assert.deepEqual(availableTypes(q), ['paid', 'unpaid']);
  // an approved request HR also marked on the same day counts once
  q = quotaFor([L('a', 'short', '2026-11-03', undefined, 'approved')], '2026-11-01', { ...Q, short_leave_per_month: 2 }, undefined, nov({ '3': 'S' }));
  assert.equal(q.shortLeft, 1);
  // another month's marks do not count
  assert.equal(quotaFor([], '2026-12-01', Q, undefined, nov({ '3': 'S' })).shortLeft, 1);
  // imported as monthly totals only
  assert.equal(quotaFor([], '2026-11-01', Q, undefined, [{ month: '2026-11-01', daily: null, short_leave_days: 1, leave_days: 1 }]).paidLeft, 0);
  // applying for short leave is refused once HR marked one
  const v = validateLeave({ leave_type: 'short', start_date: '2026-11-12', end_date: '2026-11-12' }, [], Q, '2026-11-10', nov({ '3': 'S' }));
  assert.equal(v.ok, false);
});

test('leave: validation', () => {

  const today = '2026-11-10';

  const ok = validateLeave({ leave_type: 'paid', start_date: '2026-11-12', end_date: '2026-11-12' }, [], Q, today);

  assert.deepEqual(ok, { ok: true, days: 1, overQuota: false });

  const twoPaid = validateLeave({ leave_type: 'paid', start_date: '2026-11-12', end_date: '2026-11-13' }, [], Q, today);

  assert.deepEqual(twoPaid, { ok: true, days: 2, overQuota: true }); // more than the 1 paid day: HR decides paid or absent

  const second = validateLeave({ leave_type: 'paid', start_date: '2026-11-20', end_date: '2026-11-20' }, [L('a', 'paid', '2026-11-12', undefined, 'pending')], Q, today);

  assert.deepEqual(second, { ok: true, days: 1, overQuota: true });

  const unpaid = validateLeave({ leave_type: 'unpaid', start_date: '2026-11-16', end_date: '2026-11-20' }, [L('a', 'paid', '2026-11-12')], Q, today);

  assert.deepEqual(unpaid, { ok: true, days: 5, overQuota: false });

  const clash = validateLeave({ leave_type: 'unpaid', start_date: '2026-11-11', end_date: '2026-11-13' }, [L('a', 'paid', '2026-11-12')], Q, today);

  assert.equal(clash.ok, false);

  assert.equal(validateLeave({ leave_type: 'short', start_date: '2026-11-15', end_date: '2026-11-15' }, [], Q, today).ok, false); // Sunday

  assert.equal(validateLeave({ leave_type: 'unpaid', start_date: '2026-09-01', end_date: '2026-09-01' }, [], Q, today).ok, false); // too far back

});



test('payroll lists only employees employed in the month', () => {

  const e = (doj: string | null, extra: Record<string, string> = {}, archived_at: string | null = null) => ({ doj, extra, archived_at });

  assert.equal(employedIn(e('2026-12-01'), '2026-11-01', null), false); // joins next month

  assert.equal(employedIn(e('2026-11-30'), '2026-11-01', null), true); // joins on the last day

  assert.equal(employedIn(e('2025-01-01', { 'Date of Leaving': '2026-10-31' }), '2026-11-01', null), false); // left last month

  assert.equal(employedIn(e('2025-01-01', { 'Date of Leaving': '2026-11-03' }), '2026-11-01', null), true); // leaves this month

  assert.equal(employedIn(e('2025-01-01', {}, '2026-11-05T00:00:00Z'), '2026-10-01', '2026-11-04'), true); // inactive now, worked in Oct

  assert.equal(employedIn(e('2025-01-01', {}, '2026-11-05T00:00:00Z'), '2026-10-01', null), false); // inactive, no exit date

  assert.equal(employedIn(e(null), '2026-11-01', null), true);

});





test('leave: first decision wins (team leader or HR)', () => {
  assert.equal(overallStatus('pending', 'pending'), 'pending');
  assert.equal(overallStatus('approved', 'pending'), 'approved');
  assert.equal(overallStatus('pending', 'approved'), 'approved');
  assert.equal(overallStatus('rejected', 'pending'), 'rejected');
  assert.equal(overallStatus('pending', 'rejected'), 'rejected');
  assert.equal(overallStatus('not_required', 'approved'), 'approved');
  assert.equal(overallStatus('not_required', 'pending'), 'pending');
  const r = (tl: 'pending' | 'approved' | 'rejected' | 'not_required', hr: 'pending' | 'approved' | 'rejected') =>
    ({ status: overallStatus(tl, hr), tl_status: tl, hr_status: hr, tl_by_name: 'Aman', hr_by_name: 'Riya' });
  assert.equal(stageText(r('pending', 'pending')), 'Pending with team leader or HR');
  assert.equal(stageText(r('not_required', 'pending')), 'Pending with HR');
  assert.equal(stageText(r('approved', 'pending')), 'Approved by team leader (Aman)');
  assert.equal(stageText(r('pending', 'approved')), 'Approved by HR (Riya)');
  assert.equal(stageText(r('rejected', 'pending')), 'Declined by team leader (Aman)');
  assert.equal(stageText(r('pending', 'rejected')), 'Declined by HR (Riya)');
  // once decided, only the one who decided can still act; the other side's buttons go away
  assert.equal(canDecideStep(r('pending', 'pending'), 'tl'), true);
  assert.equal(canDecideStep(r('pending', 'pending'), 'hr'), true);
  assert.equal(canDecideStep(r('approved', 'pending'), 'hr'), false);
  assert.equal(canDecideStep(r('approved', 'pending'), 'tl'), true);
  assert.equal(canDecideStep(r('pending', 'rejected'), 'tl'), false);
  assert.equal(canDecideStep(r('pending', 'rejected'), 'hr'), true);
  assert.equal(canDecideStep(r('not_required', 'pending'), 'tl'), false);
  assert.equal(decidedBy(r('approved', 'pending')), 'tl');
  assert.equal(decidedBy(r('pending', 'rejected')), 'hr');
});





test('short leave: 1 a month is fully paid, extra ones are half days', () => {

  const att = (short: number) => ({ present: 30 - short, half: 0, absent: 0, leave: 0, weekoff: 0, holiday: 0, short });

  const base = { salary: 30000, arrears: 0, otherDeduction: 0, pf: 0, tds: 0, daysInMonth: 30 };

  assert.equal(computePay({ ...base, att: att(0) }, rules(1)).net, 30000);

  const one = computePay({ ...base, att: att(1) }, rules(1));

  assert.equal(one.paidDays, 30); assert.equal(one.net, 30000); assert.equal(one.shortPaid, 1);

  const three = computePay({ ...base, att: att(3) }, rules(1));

  assert.equal(three.shortHalf, 2); assert.equal(three.paidDays, 29); assert.equal(three.net, 29000);

  // old attendance rows without a short leave count still compute the same

  const legacy = { present: 30, half: 0, absent: 0, leave: 0, weekoff: 0, holiday: 0 };

  assert.equal(computePay({ ...base, att: legacy }, rules(1)).net, 30000);

});



test('short leave is read from sheets (S / SL / Short Leave)', () => {

  const head = (d: number) => `${d}-Feb`;

  const row: SheetRow = { 'Employee Name': 'X' };

  for (let d = 1; d <= 28; d++) row[head(d)] = d === 3 ? 'Short Leave' : d === 4 ? 'SL' : d === 5 ? 's' : 'P';

  const r = parseAttendance([row], 2026, 2).rows[0];

  assert.equal(r.counts.short, 3);

  assert.equal(r.counts.present, 25);

  assert.equal(r.daily?.['3'], 'S');

});




test('paid leave (L) marked by HR never cuts salary, however many days', () => {
  const base = { salary: 30000, arrears: 0, otherDeduction: 0, pf: 0, tds: 0, daysInMonth: 30 };
  const p = computePay({ ...base, att: { present: 25, half: 0, absent: 0, leave: 5, weekoff: 0, holiday: 0, short: 0 } }, rules(1));
  assert.equal(p.paidDays, 30); assert.equal(p.net, 30000);
  // the same 5 days as absent: only the first is covered by the monthly paid leave
  const a = computePay({ ...base, att: { present: 25, half: 0, absent: 5, leave: 0, weekoff: 0, holiday: 0, short: 0 } }, rules(1));
  assert.equal(a.paidDays, 26); assert.equal(a.net, 26000);
});

test('official mail id from the employee sheet wins over the personal email', () => {
  const e = { email: 'gulamgauswarsi@gmail.com', extra: { 'Email Address': 'gulamgauswarsi@gmail.com', 'Official Mail Id': 'gulam.w@derivion.in' } };
  assert.equal(officialEmailOf(e), 'gulam.w@derivion.in');
  assert.equal(officialEmailOf({ email: 'a@derivion.in', extra: {} }), 'a@derivion.in');
  assert.equal(officialEmailOf({ email: null, extra: { 'Official Mail Id': '' } }), null);
});

test('approved leave shows as confirmed on the calendar and counts; HR marks still win', () => {
  // Nov 2026: 23rd is a Monday. Paid leave 23-24, HR already marked the 24th present.
  const days = monthDays('2026-11-01', { '24': 'P' }, null, [{ leave_type: 'paid', start_date: '2026-11-23', end_date: '2026-11-24' }]);
  assert.equal(days[22].code, 'L'); assert.equal(days[22].kind, 'leave'); assert.match(days[22].label, /approved/);
  assert.equal(days[23].code, 'P'); assert.equal(days[23].kind, 'marked');
  const c = countDays(days);
  assert.equal(c.L, 1); assert.equal(c.P, 1);
  // short leave on a week off (Sunday 22nd) is not shown
  assert.equal(monthDays('2026-11-01', null, null, [{ leave_type: 'short', start_date: '2026-11-22', end_date: '2026-11-22' }])[21].code, '');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
