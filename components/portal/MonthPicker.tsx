'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Icon } from '../Icon';
import { Spinner } from '../ui';

/** ‹ [month] › — changes ?month=YYYY-MM on the current page (keeps other params). */
export function MonthPicker({ ym, max }: { ym: string; max?: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const go = (v: string) => {
    if (!/^\d{4}-\d{2}$/.test(v)) return;
    const p = new URLSearchParams(params.toString());
    p.set('month', v);
    start(() => router.push(`${path}?${p.toString()}`, { scroll: false }));
  };
  const shift = (by: number) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + by, 1);
    go(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <div className="mpick">
      <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="chevronLeft" size={16} /></button>
      <input type="month" value={ym} max={max} onChange={e => go(e.target.value)} aria-label="Month" />
      <button type="button" className="icon-btn" onClick={() => shift(1)} disabled={!!max && ym >= max} aria-label="Next month"><Icon name="chevronRight" size={16} /></button>
      {pending && <Spinner size={16} />}
    </div>
  );
}
