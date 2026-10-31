'use client';

import { useEffect, useState } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="mbox" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'month' | 'email' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  readOnly?: boolean;
  hint?: string;
  wide?: boolean;
}

export type Values = Record<string, string>;

export function FormModal({ title, fields, initial, onSave, onClose, saveLabel = 'Save' }: {
  title: string;
  fields: Field[];
  initial: Values;
  /** Return an error message to keep the form open, or nothing to close it. */
  onSave: (v: Values) => Promise<string | void>;
  onClose: () => void;
  saveLabel?: string;
}) {
  const [v, setV] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={async e => {
        e.preventDefault();
        setBusy(true); setErr('');
        const msg = await onSave(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])));
        setBusy(false);
        if (msg) setErr(msg); else onClose();
      }}>
        <div className="mgrid">
          {fields.map(f => (
            <label key={f.key} className={f.wide ? 'wide' : ''}>
              {f.label}{f.required ? ' *' : ''}
              {f.type === 'select' ? (
                <select value={v[f.key] ?? ''} onChange={e => setV({ ...v, [f.key]: e.target.value })}>
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  type={f.type ?? 'text'} step={f.type === 'number' ? 'any' : undefined} min={f.type === 'number' ? 0 : undefined}
                  value={v[f.key] ?? ''} readOnly={f.readOnly} required={f.required}
                  onChange={e => setV({ ...v, [f.key]: e.target.value })}
                />
              )}
              {f.hint && <span className="hint">{f.hint}</span>}
            </label>
          ))}
        </div>
        {err && <p className="err" style={{ marginBottom: 0 }}>{err}</p>}
        <div className="mfoot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : saveLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
