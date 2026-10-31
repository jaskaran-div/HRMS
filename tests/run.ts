import assert from 'node:assert/strict';
import { parseAttendance } from '../lib/parse-attendance';
import { parseEmployees } from '../lib/parse-employees';
import { computePay, type PayRules } from '../lib/payroll';
import { amountInWords } from '../lib/format';
import { daysInMonth, toISODate, toMonthStart } from '../lib/dates';
import * as XLSX from 'xlsx';
import { rowsFromWorkbook, type SheetRow } from '../lib/sheet';

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

const rules = (paidLeave: number): PayRules => ({ paidLeavePerMonth: paidLeave, basicPct: 50, hraPct: 25, conveyancePct: 10 });

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
  assert.deepEqual(r.counts, { present: 21, half: 1, absent: 0, leave: 0, weekoff: 6, holiday: 0 });
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

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
