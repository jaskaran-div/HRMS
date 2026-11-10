'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

const SHOW_MS = 2 * 60 * 1000;

/**
 * A money figure hidden as "₹ xx,xxx" until the eye is clicked. It shows for 2 minutes, then hides again;
 * it also hides as soon as the browser tab is left or the page is changed (the component unmounts).
 */
export function MaskedAmount({ value, label = 'amount' }: { value: string; label?: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), SHOW_MS);
    const hide = () => { if (document.visibilityState === 'hidden') setShown(false); };
    const blur = () => setShown(false);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', blur);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', blur); };
  }, [shown]);

  return (
    <span className="masked">
      <span className={shown ? 'mv' : 'mv hidden'} aria-live="polite">{shown ? value : '₹ xx,xxx'}</span>
      <button type="button" className="eye" onClick={e => { e.preventDefault(); e.stopPropagation(); setShown(s => !s); }}
        aria-label={shown ? `Hide ${label}` : `Show ${label}`} title={shown ? 'Hide' : 'Show for 2 minutes'}>
        <Icon name={shown ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </span>
  );
}
