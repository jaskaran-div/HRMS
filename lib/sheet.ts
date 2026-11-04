import * as XLSX from 'xlsx';
import { toISODate } from './dates';

export type SheetRow = Record<string, unknown>;

/** Turns the first sheet into row objects. Skips title rows above the real header row. */
export function rowsFromWorkbook(wb: XLSX.WorkBook): SheetRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
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
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return rowsFromWorkbook(wb);
}

export function downloadXlsx(rows: SheetRow[], sheetName: string, filename: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  XLSX.writeFile(wb, filename);
}
