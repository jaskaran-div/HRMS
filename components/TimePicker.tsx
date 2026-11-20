'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fmtTime, toMinutes } from '@/lib/late';

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A time field that matches the app's inputs: shows "10:30 AM" and opens a panel to pick hour, minute (5-minute steps)
 * and AM / PM. `value` / `onChange` use 24-hour 'HH:MM' ('' = not set).
 */
export function TimePicker({ value, onChange, disabled, clearable, placeholder = 'Pick a time', id }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; clearable?: boolean; placeholder?: string; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cur = toMinutes(value);
  const h24 = cur == null ? null : Math.floor(cur / 60);
  const min = cur == null ? null : cur % 60;
  const pm = h24 != null && h24 >= 12;
  const h12 = h24 == null ? null : ((h24 + 11) % 12) + 1;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  /** Change one part; the others keep their value (default 10:00 AM when nothing is set yet). */
  function pick(p: { h12?: number; min?: number; pm?: boolean }) {
    const H = p.h12 ?? h12 ?? 10, M = p.min ?? min ?? 0, P = p.pm ?? pm;
    onChange(`${pad((H % 12) + (P ? 12 : 0))}:${pad(M)}`);
  }

  return (
    <div className="tp" ref={box}>
      <button type="button" id={id} className={`field tp-btn${open ? ' on' : ''}`} disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="clock" size={16} />
        <span className={cur == null ? 'muted' : ''}>{cur == null ? placeholder : fmtTime(value)}</span>
      </button>
      {open && !disabled && (
        <div className="tp-pop" role="dialog" aria-label="Pick a time">
          <div className="tp-cols">
            <div>
              <div className="tp-h">Hour</div>
              <div className="tp-grid">
                {HOURS.map(h => <button type="button" key={h} className={h === h12 ? 'on' : ''} onClick={() => pick({ h12: h })}>{h}</button>)}
              </div>
            </div>
            <div>
              <div className="tp-h">Minute</div>
              <div className="tp-grid">
                {MINUTES.map(m => <button type="button" key={m} className={m === min ? 'on' : ''} onClick={() => pick({ min: m })}>{pad(m)}</button>)}
              </div>
            </div>
          </div>
          <div className="tp-foot">
            <div className="tp-seg">
              <button type="button" className={cur != null && !pm ? 'on' : ''} onClick={() => pick({ pm: false })}>AM</button>
              <button type="button" className={pm ? 'on' : ''} onClick={() => pick({ pm: true })}>PM</button>
            </div>
            <span className="sp" />
            {clearable && cur != null && <button type="button" className="btn sm" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}
            <button type="button" className="btn sm primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
