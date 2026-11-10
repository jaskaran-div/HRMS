'use client';

// App-styled replacements for window.confirm / window.prompt.
//   if (!(await ask.confirm({ title: 'Delete?', message: '…', danger: true }))) return;
//   const note = await ask.prompt({ title: 'Note', label: 'Reason (optional)' });   // null = cancelled
// <DialogHost /> is mounted once in the root layout.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './Icon';

type Tone = 'danger' | 'warn' | 'primary';
interface Base {
  title: string;
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
  /** shorthand for tone: 'danger' */
  danger?: boolean;
}
export interface ConfirmOpts extends Base {
  /** the person must type this exact text before the button works (for irreversible actions) */
  typeToConfirm?: string;
}
export interface PromptOpts extends Base {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  inputType?: 'text' | 'email' | 'url';
  required?: boolean;
  /** return an error message to keep the dialog open */
  validate?: (v: string) => string | null | undefined;
}

type Req =
  | { id: number; kind: 'confirm'; o: ConfirmOpts; done: (v: boolean) => void }
  | { id: number; kind: 'prompt'; o: PromptOpts; done: (v: string | null) => void };

let queue: Req[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const push = (r: Req) => { queue = [...queue, r]; emit(); };
const pop = (id: number) => { queue = queue.filter(r => r.id !== id); emit(); };

export const ask = {
  confirm: (o: ConfirmOpts) => new Promise<boolean>(done => push({ id: ++seq, kind: 'confirm', o, done })),
  prompt: (o: PromptOpts) => new Promise<string | null>(done => push({ id: ++seq, kind: 'prompt', o, done })),
};

const ICON: Record<Tone, { name: 'alert' | 'info' | 'checkCircle'; cls: string }> = {
  danger: { name: 'alert', cls: 'danger' }, warn: { name: 'alert', cls: 'warn' }, primary: { name: 'info', cls: 'primary' },
};

export function DialogHost() {
  const list = useSyncExternalStore(
    f => { subs.add(f); return () => { subs.delete(f); }; },
    () => queue, () => queue,
  );
  const r = list[0];
  if (!r) return null;
  return <DialogBox key={r.id} r={r} />;
}

function DialogBox({ r }: { r: Req }) {
  const o = r.o;
  const tone: Tone = o.tone ?? (o.danger ? 'danger' : 'primary');
  const [val, setVal] = useState(r.kind === 'prompt' ? r.o.defaultValue ?? '' : '');
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const typed = r.kind === 'confirm' ? r.o.typeToConfirm : undefined;

  const cancel = () => { r.kind === 'confirm' ? r.done(false) : r.done(null); pop(r.id); };
  const ok = () => {
    if (r.kind === 'confirm') {
      if (typed && val.trim().toLowerCase() !== typed.toLowerCase()) { setErr(`Type ${typed} to confirm.`); return; }
      r.done(true); pop(r.id); return;
    }
    const v = val.trim();
    if (r.o.required && !v) { setErr('This cannot be empty.'); return; }
    const bad = r.o.validate?.(v);
    if (bad) { setErr(bad); return; }
    r.done(v); pop(r.id);
  };

  useEffect(() => {
    (inputRef.current ?? okRef.current)?.focus();
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocked = !!typed && val.trim().toLowerCase() !== typed.toLowerCase();
  const ic = ICON[tone];
  return (
    <div className="modal dlg-wrap" onMouseDown={e => e.target === e.currentTarget && cancel()}>
      <form className="mbox dlg" role="alertdialog" aria-modal="true" aria-labelledby={`dlg-${r.id}`}
        onSubmit={e => { e.preventDefault(); ok(); }}>
        <div className="dlg-head">
          <span className={`dlg-ic ${ic.cls}`}><Icon name={ic.name} size={22} /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 id={`dlg-${r.id}`}>{o.title}</h3>
            {o.message && <div className="dlg-msg">{o.message}</div>}
          </div>
          <button type="button" className="icon-btn dlg-x" onClick={cancel} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        {typed && (
          <label className="dlg-field">Type <b className="mono">{typed}</b> to confirm
            <input ref={inputRef} value={val} autoComplete="off" spellCheck={false} onChange={e => { setVal(e.target.value); setErr(''); }} />
          </label>
        )}
        {r.kind === 'prompt' && (
          <label className="dlg-field">{r.o.label}
            {r.o.multiline
              ? <textarea ref={inputRef} rows={3} value={val} placeholder={r.o.placeholder} onChange={e => { setVal(e.target.value); setErr(''); }}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok(); } }} />
              : <input ref={inputRef} type={r.o.inputType ?? 'text'} value={val} placeholder={r.o.placeholder} onChange={e => { setVal(e.target.value); setErr(''); }} />}
          </label>
        )}
        {err && <p className="dlg-err"><Icon name="alert" size={14} /> {err}</p>}

        <div className="mfoot">
          <button type="button" className="btn" onClick={cancel}>{o.cancelText ?? 'Cancel'}</button>
          <button ref={okRef} className={`btn ${tone === 'danger' ? 'danger-solid' : 'primary'}`} disabled={blocked}>
            {o.confirmText ?? (r.kind === 'prompt' ? 'Save' : 'Confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}
