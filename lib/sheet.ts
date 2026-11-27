// Excel / CSV in the browser. SheetJS is large, so it is loaded only when a sheet is actually read or written
// (Attendance and Import / Export open without it), like pdfmake for payslip PDFs.
import type * as XLSXTypes from 'xlsx';
import { toISODate } from './dates';

export type SheetRow = Record<string, unknown>;
type XLSXModule = typeof XLSXTypes;

let loading: Promise<XLSXModule> | undefined;
const xlsx = () => (loading ??= import('xlsx').catch(e => { loading = undefined; throw e; }));

/** Turns the first sheet into row objects. Skips title rows above the real header row. */
export function rowsFromWorkbook(wb: XLSXTypes.WorkBook, X: Pick<XLSXModule, 'utils'>): SheetRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const grid = X.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
  const filled = (r: unknown[]) => r.filter(c => String(c ?? '').trim() !== '').length;
  let h = grid.findIndex((r, i) => i < 15 && filled(r) >= 3);
  if (h < 0) h = 0;
  // A header cell that Excel stores as a real date would stringify to "Sat Nov 01 2025 …"; keep it as yyyy-mm-dd.
  const headerText = (c: unknown) => (c instanceof Date ? toISODate(c) ?? '' : String(c ?? '')).trim();
  const header = (grid[h] ?? []).map((c, i) => headerText(c) || `__col${i}`);
  const seen = new Map<string, number>();
  const keys = header.map(k => {
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n > 1 ? `${k}__${n}` : k;
  });
  return grid.slice(h + 1)
    .filter(r => filled(r) > 0)
    .map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

export async function readSheet(file: File): Promise<SheetRow[]> {
  const [X, bytes] = await Promise.all([xlsx(), file.arrayBuffer()]);
  return rowsFromWorkbook(X.read(bytes, { type: 'array', cellDates: true }), X);
}

/** Builds and downloads an .xlsx. Called from click handlers without awaiting: reports its own failure. */
export async function downloadXlsx(rows: SheetRow[], sheetName: string, filename: string): Promise<void> {
  try {
    const X = await xlsx();
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), sheetName);
    X.writeFile(wb, filename);
  } catch {
    window.alert('Could not prepare the Excel file. Check your internet connection and try again.');
  }
}
