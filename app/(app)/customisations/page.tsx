'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppContext';
import { RichEditor, type RichEditorHandle } from '@/components/RichEditor';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useLoad } from '@/lib/use-load';
import {
  DEFAULT_TEMPLATES, fillTemplate, PLACEHOLDERS, TEMPLATE_META, wrapEmail, type EmailTemplateType,
} from '@/lib/email-templates';
import { fmtDate } from '@/lib/dates';

import { ask } from '@/components/Dialog';
type Tab = 'templates' | 'sender';

interface Row { type: string; title: string | null; subject: string; body: string; updated_at: string }
const builtin = (t: string) => TEMPLATE_META.find(m => m.type === t);

import { FeatureGate } from '@/components/AddonLocked';

export default function CustomisationsPage() {
  const { isAdmin } = useApp();
  const [tab, setTab] = useState<Tab>('templates');
  const [editing, setEditing] = useState<string | null>(null);

  if (!isAdmin) return <div className="note">Only admins can change customisations.</div>;

  return (
    <>
      <div className="page-h"><h2>Customisations</h2></div>
      <div className="tabs" style={{ marginTop: 0, marginBottom: 16 }}>
        {([['templates', 'Email Templates'], ['sender', 'Sender Email Preferences']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setEditing(null); }}>{l}</button>
        ))}
      </div>
      {tab === 'templates' && <FeatureGate feature="email_center">{editing
        ? <TemplateEditor type={editing} onBack={() => setEditing(null)} />
        : <TemplateList onEdit={setEditing} />}</FeatureGate>}
      {tab === 'sender' && <SenderPrefs />}
    </>
  );
}

function TemplateList({ onEdit }: { onEdit: (t: string) => void }) {
  const { data, loading } = useLoad(async () => {
    const { data } = await supabaseBrowser().from('email_templates').select('type, title, subject, body, updated_at').order('title');
    return (data ?? []) as Row[];
  }, []);
  const saved = new Map((data ?? []).map(r => [r.type, r]));
  const custom = (data ?? []).filter(r => !builtin(r.type));
  const stamp = (t: string) => (loading ? '' : saved.get(t)
    ? <span className="pill ok">Customised · {fmtDate(saved.get(t)!.updated_at.slice(0, 10))}</span>
    : <span className="pill gray">Default</span>);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Email Templates</h3>
        <span className="sp" style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => onEdit(`custom_${Math.random().toString(36).slice(2, 8)}`)}>+ New template</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Payslip emails are sent from Payroll. Your own templates (warning letter, appreciation, policy reminder…) can be picked by HR on any employee&apos;s page under <b>Send email</b> and edited before sending.
      </p>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Template type</th><th>Status</th><th style={{ textAlign: 'right' }}>More actions</th></tr></thead>
          <tbody>
            {TEMPLATE_META.map(t => (
              <tr key={t.type} className="click" onClick={() => onEdit(t.type)}>
                <td><b>{t.title}</b><div className="muted small">{t.note}</div></td>
                <td>{stamp(t.type)}</td>
                <td style={{ textAlign: 'right' }}><button className="btn sm" onClick={e => { e.stopPropagation(); onEdit(t.type); }}>Edit</button></td>
              </tr>
            ))}
            {custom.map(r => (
              <tr key={r.type} className="click" onClick={() => onEdit(r.type)}>
                <td><b>{r.title || r.subject}</b><div className="muted small">Custom template · sent manually from an employee&apos;s page</div></td>
                <td><span className="pill ok">Custom</span></td>
                <td style={{ textAlign: 'right' }}><button className="btn sm" onClick={e => { e.stopPropagation(); onEdit(r.type); }}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const sampleVars = (company: string) => Object.fromEntries(PLACEHOLDERS.map(p => [p.key, p.key === 'CompanyName' ? company : p.sample]));

const BLANK = '<p><b>Hi %EmployeeName%,</b></p><p></p><p style="color:#5b6070;font-size:13px">Regards,<br>Team %CompanyName%</p>';

function TemplateEditor({ type, onBack }: { type: string; onBack: () => void }) {
  const { settings, notify } = useApp();
  const meta = builtin(type);
  const { data, loading, reload } = useLoad(async () => {
    const { data } = await supabaseBrowser().from('email_templates').select('type, title, subject, body, updated_at').eq('type', type).maybeSingle();
    return (data ?? null) as Row | null;
  }, [type]);
  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [initial, setInitial] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const edit = useRef<RichEditorHandle>(null);

  useEffect(() => {
    if (loading) return;
    const t = data ?? (meta ? DEFAULT_TEMPLATES[meta.type as EmailTemplateType] : { subject: '', body: BLANK });
    setSubject(t.subject); setHtml(t.body); setTitle(data?.title ?? '');
    setInitial(t.body);
  }, [loading, data, meta]);

  async function save() {
    if (!subject.trim()) { notify('The subject cannot be empty.', 'err'); return; }
    if (!meta && !title.trim()) { notify('Give the template a name.', 'err'); return; }
    setBusy(true);
    const { error } = await supabaseBrowser().from('email_templates').upsert(
      { org_id: settings.org_id, type, title: meta ? null : title.trim(), subject: subject.trim(), body: edit.current?.html() ?? html, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,type' });
    setBusy(false);
    if (error) { notify(error.message, 'err'); return; }
    notify('Template saved');
    reload();
  }

  async function reset() {
    if (!(await ask.confirm(meta
      ? { title: 'Restore the built-in text?', message: 'Your edits to this template will be lost.', confirmText: 'Restore', tone: 'warn' }
      : { title: 'Delete this template?', confirmText: 'Delete', danger: true }))) return;
    const { error } = await supabaseBrowser().from('email_templates').delete().eq('type', type);
    if (error) { notify(error.message, 'err'); return; }
    notify(meta ? 'Reset to default' : 'Template deleted');
    if (meta) reload(); else onBack();
  }

  async function sendTest() {
    setSending(true);
    const res = await fetch('/api/email/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body: edit.current?.html() ?? html }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; from?: string };
    setSending(false);
    if (!res.ok) notify(j.error ?? 'Could not send the test email.', 'err');
    else notify(`Test email sent to ${to} from ${j.from}`);
  }

  const vars = sampleVars(settings.company_name);
  return (
    <>
      <div className="page-h">
        <button className="btn" onClick={onBack}>← Back</button>
        <h2 style={{ fontSize: 18 }}>{meta ? `Edit template for ${meta.title}` : title || 'New custom template'}</h2>
      </div>
      <div className="note warn" style={{ marginBottom: 14 }}>
        Emails are sent from <b>{settings.sender_email}</b> (change it under Sender Email Preferences). Placeholders like <b>%EmployeeName%</b> are replaced with each employee&apos;s details.
        {meta ? ' The payslip PDF is attached automatically.' : " HR picks this template on an employee's page and can still edit it before sending."}
      </div>
      <div className="card">
        <div className="mgrid" style={{ gridTemplateColumns: '1fr' }}>
          {!meta && <label>Template name<input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Warning letter" disabled={initial === null} /></label>}
          <label>Subject<input value={subject} onChange={e => setSubject(e.target.value)} disabled={initial === null} /></label>
        </div>
        {initial !== null && <RichEditor key={`${type}-${data?.updated_at ?? 'new'}`} ref={edit} initial={initial} companyName={settings.company_name} onChange={setHtml} />}
        <div className="row" style={{ marginTop: 16, marginBottom: 0 }}>
          <button className="btn primary" disabled={busy || initial === null} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
          {data && <button className="btn" onClick={reset}>{meta ? 'Reset to default' : 'Delete'}</button>}
          <span className="sp" style={{ flex: 1 }} />
          <input className="field" type="email" placeholder="Send a test to…" value={to} onChange={e => setTo(e.target.value)} />
          <button className="btn" disabled={sending || !to.trim()} onClick={sendTest}>{sending ? 'Sending…' : 'Send test email'}</button>
        </div>
      </div>

      <div className="card">
        <h3>Preview with sample values</h3>
        <p className="muted small" style={{ marginTop: 0 }}><b>Subject:</b> {fillTemplate(subject, vars, false)}</p>
        <div dangerouslySetInnerHTML={{ __html: wrapEmail(fillTemplate(html, vars, true), settings, { inlineLogo: true }) }} />
      </div>
    </>
  );
}

function SenderPrefs() {
  const { settings, notify } = useApp();
  const router = useRouter();
  // the first organization (Derivion) chooses its sender address, as before; other organizations send from the
  // platform's address (with their own name) — an address the server's SMTP account is not allowed to use would bounce
  const legacy = settings.id === 1;
  const [f, setF] = useState({ sender_name: settings.sender_name ?? '', sender_email: settings.sender_email || '', reply_to: settings.reply_to ?? '', email_domains: settings.email_domains ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (legacy && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.sender_email.trim())) { notify('Enter a valid sender email address.', 'err'); return; }
    setBusy(true);
    const { error } = await supabaseBrowser().from('settings').update({
      sender_name: f.sender_name.trim() || null, ...(legacy ? { sender_email: f.sender_email.trim() } : {}), reply_to: f.reply_to.trim() || null,
      email_domains: f.email_domains.split(',').map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean).join(',') || null,
    }).eq('id', settings.id);
    setBusy(false);
    if (error) { notify(error.message, 'err'); return; }
    notify('Saved');
    router.refresh();
  }

  return (
    <form className="card" onSubmit={save}>
      <h3>Sender Email Preferences</h3>
      <p className="muted small" style={{ marginTop: 0 }}>Employees see emails from <b>“{f.sender_name.trim() || settings.company_name}”</b>{f.reply_to.trim() ? <>, and replies go to <b>{f.reply_to.trim()}</b></> : null}.</p>
      <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
        <label>Sender name<input value={f.sender_name} onChange={set('sender_name')} placeholder={settings.company_name} /><span className="hint">Shown as the sender. Blank = company name.</span></label>
        {legacy
          ? <label>Sender email<input type="email" value={f.sender_email} onChange={set('sender_email')} required /><span className="hint">Emails are sent from this address. It must be allowed by the server’s SMTP account.</span></label>
          : <label>Sender email<input value={settings.sender_email ?? ''} readOnly /><span className="hint">The sending address is managed by the platform.</span></label>}
        <label>Reply-to (optional)<input type="email" value={f.reply_to} onChange={set('reply_to')} /><span className="hint">Replies from employees go here.</span></label>
        <label>Official email domains<input value={f.email_domains} onChange={set('email_domains')} placeholder="company.com, company.in" /><span className="hint">Emails only go to addresses at these domains (never personal ones). Comma separated. Blank = the sender address’s domain.</span></label>
      </div>
      <div className="row" style={{ marginTop: 14, marginBottom: 0 }}><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}
