import Link from 'next/link';
import { daysInMonth, monthLabel } from '@/lib/dates';
import { CODE_LABEL, CODE_CLS, countDays, monthDays, type DayCode, type ViewLeave } from '@/lib/att-view';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ORDER: DayCode[] = ['P', 'A', 'H', 'L', 'S', 'W', 'O'];

export function AttendanceLegend() {
  return (
    <div className="cal-legend">
      {ORDER.map(c => <span key={c}><i className={`cell ${CODE_CLS[c]}`}>{c}</i>{CODE_LABEL[c]}</span>)}
      <span><i className="cell lv">L</i>Approved leave, not marked yet</span>
    </div>
  );
}

/** Summary chips for a month. */
export function CountChips({ c }: { c: ReturnType<typeof countDays> }) {
  return (
    <div className="cal-sum">
      {ORDER.map(k => <div key={k} className={`cs ${CODE_CLS[k]}`}><b>{c[k]}</b><small>{CODE_LABEL[k]}</small></div>)}
    </div>
  );
}

/** One person's month as a calendar (Mon–Sun weeks). month = YYYY-MM-01. */
export function AttendanceCalendar({ month, daily, doj, leaves = [], today }: {
  month: string; daily: Record<string, string> | null | undefined; doj?: string | null; leaves?: ViewLeave[]; today?: string;
}) {
  const [y, m] = month.split('-').map(Number);
  const days = monthDays(month, daily, doj, leaves);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // blanks before the 1st (weeks start Monday)
  const cells: (number | null)[] = [...Array(lead).fill(null), ...days.map((_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <>
      <CountChips c={countDays(days)} />
      <div className="cal">
        {WEEK.map(w => <div key={w} className={`cal-h ${w === 'Sun' ? 'sun' : ''}`}>{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="cal-d blank" />;
          const v = days[d - 1];
          const iso = `${month.slice(0, 8)}${String(d).padStart(2, '0')}`;
          const cls = v.kind === 'off' ? 'off' : v.code ? CODE_CLS[v.code as DayCode] : '';
          return (
            <div key={d} className={`cal-d ${cls} ${v.kind === 'leave' ? 'lv' : ''} ${iso === today ? 'today' : ''} ${i % 7 === 6 ? 'sun' : ''}`} title={v.label}>
              <span className="n">{d}</span>
              {v.code && v.kind !== 'off' && <span className="c">{v.code}</span>}
              <small>{v.kind === 'off' ? 'Not joined' : v.kind === 'empty' ? '' : v.kind === 'leave' ? 'Approved' : CODE_LABEL[v.code as DayCode]}</small>
            </div>
          );
        })}
      </div>
    </>
  );
}

export interface GridPerson {
  id: string; name: string; emp_code: string; doj: string | null; you?: boolean;
  daily: Record<string, string> | null; leaves: ViewLeave[]; href?: string;
}

/** Read-only day-by-day grid for several people (team leader view), like HR's attendance sheet. */
export function TeamAttendanceGrid({ month, people }: { month: string; people: GridPerson[] }) {
  const [y, m] = month.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const dow = (d: number) => new Date(y, m - 1, d).getDay();
  return (
    <div className="grid-wrap">
      <table className="ag">
        <thead>
          <tr>
            <th className="name">Employee</th>
            {Array.from({ length: dim }, (_, i) => i + 1).map(d => (
              <th key={d} className={dow(d) === 0 ? 'sun' : ''}><span className="dayh">{d}<small>{'SMTWTFS'[dow(d)]}</small></span></th>
            ))}
            <th>P</th><th>A</th><th>½</th><th>L</th><th title="Short leave">S</th><th>W</th><th title="Holiday">O</th>
          </tr>
        </thead>
        <tbody>
          {people.map(p => {
            const days = monthDays(month, p.daily, p.doj, p.leaves);
            const c = countDays(days);
            return (
              <tr key={p.id}>
                <td className="name">
                  <div className="nm">{p.href ? <Link href={p.href}><b>{p.name}</b></Link> : <b>{p.name}</b>}{p.you && <span className="muted"> (you)</span>}<small>{p.emp_code}</small></div>
                </td>
                {days.map((v, i) => (
                  <td key={i} className={dow(i + 1) === 0 ? 'sun' : ''}>
                    <span className={`cell ro ${v.kind === 'off' ? 'off' : v.code ? CODE_CLS[v.code as DayCode] : ''} ${v.kind === 'leave' ? 'lv' : ''}`} title={`${i + 1} ${monthLabel(month, false)} · ${v.label}`}>
                      {v.kind === 'off' ? '' : v.code}
                    </span>
                  </td>
                ))}
                <td className="n">{c.P}</td><td className="n">{c.A}</td><td className="n">{c.H}</td><td className="n">{c.L}</td><td className="n">{c.S}</td><td className="n">{c.W}</td><td className="n">{c.O}</td>
              </tr>
            );
          })}
          {!people.length && <tr><td colSpan={dim + 8} className="muted" style={{ padding: 24 }}>Nobody to show.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
