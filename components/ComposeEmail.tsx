'use client';

import { useRef, useState } from 'react';
import { Modal } from './Modal';
import { RichEditor, type RichEditorHandle } from './RichEditor';
import { useApp } from './AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useLoad } from '@/lib/use-load';
import { DEFAULT_TEMPLATES, TEMPLATE_META } from '@/lib/email-templates';
import { payslipDocument, payslipFilename, pdfMake, type PayslipCompany } from '@/lib/payslip-pdf';
import { fmtDate, monthLabel } from '@/lib/dates';
import { inr } from '@/lib/format';
import type { Employee, PayslipData } from '@/lib/types';

interface Tpl { key: string; label: string; subject: string; body: string }

const MAX_FILE = 5 * 1024 * 1024;
const BLANK: Tpl = { key: '', label: 'Blank email', subject: '', body: '<p><b>Hi %EmployeeName%,</b></p><p></p><p style="color:#5b6070;font-size:13px">Regards,<br>Team %CompanyName%</p>' };

const toBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] ?? '');
  r.onerror = () => rej(new Error(`Could not read ${f.name}`));
  r.readAsDataURL(f);
});

/** HR picks a template (or starts blank), edits subject and message, optionally attaches a payslip / files, and sends to this employee only. */
export function ComposeEmail({ emp, payslips, company, onClose }: {
  emp: Employee; payslips: PayslipData[]; company: PayslipCompany; onClose: () => void;
}) {
  const { notify, settings } = useApp();
  const [tplKey, setTplKey] = useState('');
  const [subject, setSubject] = useState('');
  const [initial, setInitial] = useState(BLANK.body);
  const [editorKey, setEditorKey] = useState(0);
  const [slipMonth, setSlipMonth] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const editor = useRef<RichEditorHandle>(null);

  const { data: tpls = [] } = useLoad(async () => {
    const { data } = await supabaseBrowser().from('email_templates').select('type, title, subject, body');
    const saved = new Map(((data ?? []) as { type: string; title: string | null; subject: string; body: string }[]).map(r => [r.type, r]));
    const list: Tpl[] = [BLANK];
    for (const m of TEMPLATE_META) {
      const r = saved.get(m.type) ?? DEFAULT_TEMPLATES[m.type];
      list.push({ key: m.type, label: m.title, subject: r.subject, body: r.body });
    }
    for (const r of saved.values()) if (!TEMPLATE_META.some(m => m.type === r.type)) list.push({ key: r.type, label: r.title || r.subject, subject: r.subject, body: r.body });
    return list;
  }, []);

  function pick(key: string) {
    setTplKey(key);
    const t = tpls.find(x => x.key === key) ?? BLANK;
    setSubject(t.subject);
    setInitial(t.body);
    setEditorKey(k => k + 1);
  }

  const totalSize = files.reduce((n, f) => n + f.size, 0);

  async function send() {
    if (!subject.trim()) { notify('Write a subject.', 'err'); return; }
    const body = editor.current?.html() ?? '';
    if (!body.replace(/<[^>]+>/g, '').trim()) { notify('Write the message.', 'err'); return; }
    if (totalSize > MAX_FILE) { notify('Attachments are too large (5 MB total).', 'err'); return; }
    setBusy(true);
    try {
      const attachments: { filename: string; base64: string; contentType?: string }[] = [];
      let vars: Record<string, string> = {};
      const slip = payslips.find(p => p.month === slipMonth);
      if (slip) {
        const pm = await pdfMake();
        attachments.push({ filename: payslipFilename(slip), base64: await pm.createPdf(payslipDocument([slip], company)).getBase64(), contentType: 'application/pdf' });
        vars = { PayPeriodMonth: monthLabel(slip.month), PayDate: fmtDate(slip.payDate), NetPay: inr(slip.net) };
      }
      for (const f of files) attachments.push({ filename: f.name, base64: await toBase64(f), contentType: f.type || undefined });
      const res = await fetch('/api/email/compose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: emp.id, subject, body, vars, attachments }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; to?: string };
      if (!res.ok) { notify(j.error ?? `Could not send (${res.status})`, 'err'); setBusy(false); return; }
      notify(`Email sent to ${emp.name} (${j.to})`);
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Send email — ${emp.name}`} onClose={onClose}>
      <div className="mgrid" style={{ gridTemplateColumns: '1fr' }}>
        <label>To<input value={emp.email ? `${emp.name} <${emp.email}>` : 'No email address on file — add it with Edit details'} readOnly /></label>
        <label>Template
          <select value={tplKey} onChange={e => pick(e.target.value)}>
            <option value="" disabled>Choose a template…</option>
            {tpls.map(t => <option key={t.key || 'blank'} value={t.key}>{t.label}</option>)}
          </select>
          <span className="hint">Manage templates (warning letter, etc.) under Customisations. Whatever you pick can still be edited below before sending.</span>
        </label>
        <label>Subject<input value={subject} onChange={e => setSubject(e.target.value)} /></label>
      </div>
      <RichEditor key={editorKey} ref={editor} initial={initial} companyName={settings.company_name} minHeight={170} />
      <div className="mgrid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
        <label>Attach a payslip (optional)
          <select value={slipMonth} onChange={e => setSlipMonth(e.target.value)}>
            <option value="">No payslip</option>
            {payslips.map(p => <option key={p.month} value={p.month}>{monthLabel(p.month)}</option>)}
          </select>
        </label>
        <label>Attach files (optional)
          <input type="file" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))} />
          <span className="hint">{files.length ? `${files.length} file(s), ${(totalSize / 1024 / 1024).toFixed(1)} MB` : 'Up to 5 MB in total.'}</span>
        </label>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>Placeholders such as %EmployeeName% are filled in automatically when the email is sent.</p>
      <div className="mfoot">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || !emp.email?.trim() || !tplKey && !subject} onClick={send}>{busy ? 'Sending…' : 'Send email'}</button>
      </div>
    </Modal>
  );
}
