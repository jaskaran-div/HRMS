const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Month index 1-12 from a name or prefix ("Feb", "february"); null if not a month. */
export function monthFromName(s: string): number | null {
  const i = MONTHS.indexOf(s.trim().toLowerCase().slice(0, 3));
  return i >= 0 && s.trim().length >= 3 ? i + 1 : null;
}

export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

/** "2026-07" -> "2026-07-01" */
export const monthStart = (ym: string) => `${ym.slice(0, 7)}-01`;

export const currentYM = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function monthLabel(iso: string, long = true): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: 'numeric' });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateSlash(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Previous / next month of a YYYY-MM-01 string. */
export function shiftMonth(iso: string, by: number): string {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/**
 * Anything a spreadsheet can give us for a date -> "YYYY-MM-DD" (or null).
 * Handles Date objects, Excel serials, ISO strings, "12 Apr 2021", and dd/mm/yyyy (Indian order).
 */
export function toISODate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // SheetJS can hand back local midnight minus a few minutes; +12h keeps us on the right day
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    return null;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,.-]+(\d{2,4})$/.exec(s);
  if (m) {
    const mo = monthFromName(m[2]);
    if (mo) return `${m[3].length === 2 ? 2000 + +m[3] : +m[3]}-${pad(mo)}-${pad(+m[1])}`;
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : toISODate(new Date(t));
}

/** Month cell ("Feb 2026", "2026-02", Date) -> "YYYY-MM-01" or null. */
export function toMonthStart(v: unknown): string | null {
  if (v instanceof Date) { const iso = toISODate(v); return iso ? `${iso.slice(0, 7)}-01` : null; }
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-01`;
  m = /^([A-Za-z]{3,9})[\s,.-]+(\d{2,4})$/.exec(s);
  if (m) { const mo = monthFromName(m[1]); if (mo) return `${m[2].length === 2 ? 2000 + +m[2] : m[2]}-${pad(mo)}-01`; }
  return null;
}
