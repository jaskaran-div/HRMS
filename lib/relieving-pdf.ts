import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { RelievingLetterData } from './types';
import type { PayslipCompany } from './payslip-pdf';
import { pdfMake } from './payslip-pdf';
import { fmtDate } from './dates';

const GREY = '#6b6f7b';
const LINE = '#c9cbe0';
const WIDTH = 523;

export function relievingDocument(l: RelievingLetterData, c: PayslipCompany): TDocumentDefinitions {
  const role = [l.employee.designation, l.employee.department && `${l.employee.department} department`].filter(Boolean).join(', ');
  return {
    pageSize: 'A4',
    pageMargins: [50, 48, 50, 48],
    defaultStyle: { font: 'Roboto', fontSize: 11, color: '#1c1f2b', lineHeight: 1.35 },
    info: { title: `Relieving Letter ${l.employee.code}` },
    content: [
      {
        columns: [
          { width: '*', stack: [...(c.logo ? [{ image: c.logo, fit: [170, 54] as [number, number], margin: [0, 0, 0, 8] as [number, number, number, number] }] : []), { text: c.name, bold: true, fontSize: 16 }, { text: c.address, fontSize: 8.5, color: GREY, margin: [0, 3, 0, 0] }] },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 1, lineColor: LINE }], margin: [0, 10, 0, 22] },
      { text: `Date: ${fmtDate(l.issueDate)}`, alignment: 'right', margin: [0, 0, 0, 22] },
      { text: 'RELIEVING LETTER', bold: true, fontSize: 14, alignment: 'center', margin: [0, 0, 0, 22] },
      { text: `To,\n${l.employee.name}\nEmployee ID: ${l.employee.code}`, margin: [0, 0, 0, 18] },
      { text: `Subject: Relieving from employment`, bold: true, margin: [0, 0, 0, 14] },
      { text: `Dear ${l.employee.name},`, margin: [0, 0, 0, 12] },
      {
        text: [
          `This is to confirm that you have been relieved from the services of ${c.name} with effect from the close of business hours on `,
          { text: fmtDate(l.relievedOn), bold: true },
          '.',
        ],
        margin: [0, 0, 0, 10],
      },
      {
        text: `You joined the company${l.doj ? ` on ${fmtDate(l.doj)}` : ''}${role ? ` and last served as ${role}` : ''}. `
          + 'Your full and final settlement will be processed as per company policy.',
        margin: [0, 0, 0, 10],
      },
      { text: 'We thank you for your contribution to the company and wish you all the best in your future endeavours.', margin: [0, 0, 0, 40] },
      { text: 'Yours sincerely,', margin: [0, 0, 0, 36] },
      { text: `For ${c.name}`, bold: true },
      { text: 'Authorised Signatory — Human Resources', color: GREY, fontSize: 10, margin: [0, 2, 0, 0] },
      { text: c.footer, alignment: 'center', fontSize: 8, color: GREY, margin: [0, 60, 0, 0] },
    ],
  };
}

export const relievingFilename = (l: RelievingLetterData) => `Relieving_Letter_${l.employee.code}.pdf`;

export async function downloadRelieving(l: RelievingLetterData, c: PayslipCompany) {
  const pm = await pdfMake();
  await pm.createPdf(relievingDocument(l, c)).download(relievingFilename(l));
}

export async function openRelieving(l: RelievingLetterData, c: PayslipCompany) {
  const pm = await pdfMake();
  await pm.createPdf(relievingDocument(l, c)).open();
}
