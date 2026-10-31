import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import type { PayslipData } from './types';
import { amountInWords, inr } from './format';
import { fmtDateSlash, monthLabel } from './dates';

export interface PayslipCompany {
  name: string;
  address: string;
  logo?: string | null;
  footer: string;
}

const GREY = '#6b6f7b';
const LINE = '#c9cbe0';
const GREEN_BG = '#eaf8ee';
const GREEN = '#2e9e57';
const WIDTH = 523; // A4 (595pt) minus 2 x 36pt margins

const cell = (text: string, o: Record<string, unknown> = {}) => ({ text, fontSize: 9.5, margin: [6, 5, 6, 5], ...o }) as TableCell;

function slip(p: PayslipData, c: PayslipCompany): Content[] {
  const period = monthLabel(p.month);
  const rows = Math.max(p.earnings.length, p.deductions.length);
  const body: TableCell[][] = [[
    cell('EARNINGS', { bold: true, color: '#444' }), cell('AMOUNT', { bold: true, alignment: 'right', color: '#444' }),
    cell('DEDUCTIONS', { bold: true, color: '#444' }), cell('AMOUNT', { bold: true, alignment: 'right', color: '#444' }),
  ]];
  for (let i = 0; i < rows; i++) {
    const e = p.earnings[i], d = p.deductions[i];
    body.push([
      cell(e?.label ?? ''), cell(e ? inr(e.amount) : '', { alignment: 'right', bold: true }),
      cell(d?.label ?? ''), cell(d ? inr(d.amount) : '', { alignment: 'right', bold: true }),
    ]);
  }
  body.push([
    cell('Gross Earnings', { bold: true, fillColor: '#f6f6fa', color: '#444' }), cell(inr(p.gross), { bold: true, alignment: 'right', fillColor: '#f6f6fa' }),
    cell('Total Deductions', { bold: true, fillColor: '#f6f6fa', color: '#444' }), cell(inr(p.totalDeductions), { bold: true, alignment: 'right', fillColor: '#f6f6fa' }),
  ]);

  const summary = (label: string, value: string): TableCell[] => [
    { text: label, color: GREY, fontSize: 10, margin: [0, 3, 0, 3] },
    { text: ':', color: GREY, fontSize: 10, margin: [0, 3, 0, 3] },
    { text: value, fontSize: 10, margin: [0, 3, 0, 3] },
  ];

  const paidFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return [
    {
      columns: [
        c.logo ? { image: c.logo, width: 62, margin: [0, 0, 12, 0] } : { text: '', width: 0 },
        {
          width: '*',
          stack: [
            { text: c.name, bold: true, fontSize: 16 },
            { text: c.address, fontSize: 8.5, color: GREY, margin: [0, 3, 0, 0] },
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: 'Payslip For the Month', fontSize: 9, color: GREY, alignment: 'right' },
            { text: period, bold: true, fontSize: 13, alignment: 'right', margin: [0, 2, 0, 0] },
          ],
        },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 1, lineColor: LINE }], margin: [0, 10, 0, 16] },
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'EMPLOYEE SUMMARY', bold: true, fontSize: 9.5, color: GREY, margin: [0, 0, 0, 6] },
            {
              table: {
                widths: [96, 10, '*'],
                body: [
                  summary('Employee Name', p.employee.name),
                  summary('Employee ID', p.employee.code),
                  summary('Pay Period', period),
                  summary('Pay Date', fmtDateSlash(p.payDate)),
                ],
              },
              layout: 'noBorders',
            },
          ],
        },
        {
          width: 218,
          table: {
            widths: ['*'],
            body: [
              [{
                fillColor: GREEN_BG,
                margin: [14, 10, 10, 10],
                stack: [
                  { text: inr(p.net), fontSize: 20 },
                  { text: 'Total Net Pay', fontSize: 10, color: '#5d8f6c', margin: [0, 2, 0, 0] },
                ],
              }],
              [{
                margin: [14, 6, 10, 6],
                table: {
                  widths: [90, 10, '*'],
                  body: [
                    [{ text: 'Paid Days', color: GREY, fontSize: 10 }, { text: ':', color: GREY }, { text: paidFmt(p.paidDays), fontSize: 10 }],
                    [{ text: 'LOP Days', color: GREY, fontSize: 10 }, { text: ':', color: GREY }, { text: paidFmt(p.lopDays), fontSize: 10 }],
                  ],
                },
                layout: 'noBorders',
              }],
            ],
          },
          layout: {
            hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => LINE, vLineColor: () => LINE,
          },
        },
      ],
    },
    {
      margin: [0, 26, 0, 0],
      table: { widths: ['*', 'auto', '*', 'auto'], body },
      layout: {
        hLineWidth: (i: number) => (i === 0 || i === body.length ? 1 : i === 1 ? 0.6 : 0),
        vLineWidth: (i: number) => (i === 0 || i === 4 ? 1 : 0),
        hLineColor: () => LINE,
        vLineColor: () => LINE,
        hLineStyle: (i: number) => (i === 1 ? { dash: { length: 2 } } : null),
      },
    },
    {
      margin: [0, 18, 0, 0],
      table: {
        widths: ['*', 130],
        body: [[
          {
            margin: [8, 8, 8, 8],
            stack: [
              { text: 'TOTAL NET PAYABLE', bold: true, fontSize: 10 },
              { text: 'Gross Earnings - Total Deductions', fontSize: 9, color: GREY, margin: [0, 2, 0, 0] },
            ],
          },
          { text: inr(p.net), bold: true, fontSize: 13, alignment: 'center', fillColor: GREEN_BG, color: '#111', margin: [4, 14, 4, 14] },
        ]],
      },
      layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => LINE, vLineColor: () => LINE },
    },
    {
      margin: [0, 14, 0, 0],
      alignment: 'right',
      fontSize: 9.5,
      text: [{ text: 'Amount In Words : ', color: GREY }, { text: amountInWords(p.net) }],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 1, lineColor: LINE }], margin: [0, 12, 0, 22] },
    { text: c.footer, alignment: 'center', fontSize: 8, color: GREY },
  ];
}

export function payslipDocument(slips: PayslipData[], c: PayslipCompany): TDocumentDefinitions {
  const content: Content[] = [];
  slips.forEach((s, i) => {
    content.push({ stack: slip(s, c), pageBreak: i > 0 ? 'before' : undefined } as Content);
  });
  return {
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 36],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1c1f2b' },
    info: { title: slips.length === 1 ? `Payslip ${slips[0].employee.code} ${monthLabel(slips[0].month)}` : 'Payslips' },
  };
}

/** Browser only. Loads pdfmake on demand so it is not part of every page's bundle. */
async function pdfMake() {
  const [{ default: pm }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pm.addVirtualFileSystem(vfs);
  return pm;
}

export async function downloadPayslips(slips: PayslipData[], c: PayslipCompany, filename: string) {
  const pm = await pdfMake();
  await pm.createPdf(payslipDocument(slips, c)).download(filename);
}

export async function openPayslips(slips: PayslipData[], c: PayslipCompany) {
  const pm = await pdfMake();
  await pm.createPdf(payslipDocument(slips, c)).open();
}

export const payslipFilename = (p: PayslipData) =>
  `Payslip_${p.employee.code}_${monthLabel(p.month, false).replace(' ', '_')}.pdf`;
