'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PLACEHOLDERS } from '@/lib/email-templates';

export interface RichEditorHandle { html: () => string; setHtml: (h: string) => void }

/** Small rich-text box for email bodies. Uncontrolled: set the text with `initial` / setHtml, read it with html() or onChange. */
export const RichEditor = forwardRef<RichEditorHandle, {
  initial: string; companyName: string; onChange?: (html: string) => void; minHeight?: number;
}>(function RichEditor({ initial, companyName, onChange, minHeight = 200 }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => { if (box.current) box.current.innerHTML = initial; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useImperativeHandle(ref, () => ({
    html: () => box.current?.innerHTML ?? '',
    setHtml: h => { if (box.current) box.current.innerHTML = h; onChange?.(h); },
  }));

  const sync = () => onChange?.(box.current?.innerHTML ?? '');
  const exec = (cmd: string, arg?: string) => { box.current?.focus(); document.execCommand(cmd, false, arg); sync(); };
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <>
      <div className="rte-bar">
        <select onChange={e => { exec('formatBlock', e.target.value); e.target.value = ''; }} defaultValue="" aria-label="Headings">
          <option value="" disabled>Headings</option>
          <option value="p">Normal</option><option value="h2">Heading 1</option><option value="h3">Heading 2</option>
        </select>
        <button type="button" className="btn sm" title="Bold" onMouseDown={keep} onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" className="btn sm" title="Italic" onMouseDown={keep} onClick={() => exec('italic')}><i>I</i></button>
        <button type="button" className="btn sm" title="Underline" onMouseDown={keep} onClick={() => exec('underline')}><u>U</u></button>
        <button type="button" className="btn sm" title="Strikethrough" onMouseDown={keep} onClick={() => exec('strikeThrough')}><s>S</s></button>
        <button type="button" className="btn sm" title="Bulleted list" onMouseDown={keep} onClick={() => exec('insertUnorderedList')}>• List</button>
        <button type="button" className="btn sm" title="Numbered list" onMouseDown={keep} onClick={() => exec('insertOrderedList')}>1. List</button>
        <button type="button" className="btn sm" title="Link" onMouseDown={keep}
          onClick={() => { const u = prompt('Link address (https://…)'); if (u && /^(https?:|mailto:)/i.test(u.trim())) exec('createLink', u.trim()); }}>🔗 Link</button>
        <span className="sp" style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <button type="button" className="btn sm" onMouseDown={keep} onClick={() => setMenu(m => !m)}>Insert Placeholders ▾</button>
          {menu && (
            <div className="rte-menu">
              {PLACEHOLDERS.map(p => (
                <button key={p.key} type="button" onMouseDown={keep} onClick={() => { setMenu(false); exec('insertText', `%${p.key}%`); }}>
                  <b>%{p.key}%</b><small>{p.label}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="rte-stage">
        <div className="rte-card">
          <div className="rte-head">{companyName}</div>
          <div ref={box} className="rte-box" style={{ minHeight }} contentEditable suppressContentEditableWarning onInput={sync} onBlur={sync} />
        </div>
      </div>
    </>
  );
});
