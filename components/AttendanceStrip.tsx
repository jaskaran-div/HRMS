import { daysInMonth } from '@/lib/dates';

export type StripMark = 'p' | 'a' | 'h' | 'l' | 's' | 'o' | 'w' | 'mid' | 'low' | '';

const LEGEND: [string, string][] = [
  ['var(--ok)', 'Present'], ['var(--bad)', 'Absent'], ['var(--bad)', 'Half day'], ['var(--brand)', 'Paid leave'],
  ['var(--teal)', 'Short leave'], ['#d63bd1', 'Holiday'], ['#dfe3e8', 'Week off / not marked'],
];
const CODE: Record<string, StripMark> = { P: 'p', A: 'a', H: 'h', L: 'l', S: 's', O: 'o', W: 'w' };
export const markOf = (code: string | undefined): StripMark => (code ? CODE[code] ?? '' : '');

export function StripLegend({ company = false }: { company?: boolean }) {
  const items: [string, string][] = company
    ? [['var(--ok)', '90%+ present'], ['#f5a524', '70–90%'], ['var(--bad)', 'under 70%'], ['#dfe3e8', 'Week off / no data']]
    : LEGEND;
  return <div className="strip-legend">{items.map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>;
}

/** One circle per day of the month (YYYY-MM-01), like a calendar row. `today` is highlighted. */
export function AttendanceStrip({ month, marks, titles = {}, today }: {
  month: string; marks: Record<number, StripMark>; titles?: Record<number, string>; today?: string;
}) {
  const [y, m] = month.split('-').map(Number);
  const dim = daysInMonth(y, m);
  return (
    <div className="strip" style={{ ["--days" as string]: dim } as React.CSSProperties}>
      {Array.from({ length: dim }, (_, i) => i + 1).map(d => {
        const iso = `${month.slice(0, 8)}${String(d).padStart(2, '0')}`;
        const mark = marks[d] ?? '';
        const weekend = new Date(y, m - 1, d).getDay() === 0;
        return (
          <div key={d} className={`d ${iso === today ? 'today' : ''} ${weekend || mark === 'w' ? 'wk' : ''}`} title={titles[d]}>
            <small>{String(d).padStart(2, '0')}</small>
            <span className={`ad ${mark}`}>
              {(mark === 'p' || mark === 'l' || mark === 's') && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              )}
              {mark === 'a' && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
