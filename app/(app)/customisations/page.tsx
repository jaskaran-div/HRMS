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
import { ErrorBox } from '@/components/ui';
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
  // the first organization (Derivion) sends from its own address through the server's SMTP, as before
  const legacy = settings.id === 1;
  const mail = useLoad(async () => {
    const r = await fetch('/api/org/mail');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? 'Could not load the mail settings');
    return j as MailInfo;
  }, []);
  const own = mail.data?.server ?? null;
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

  const shownAddress = own?.from_email ?? (legacy ? f.sender_email : mail.data?.platform_sender ?? settings.sender_email);
  return (
    <>
    <form className="card" onSubmit={save}>
      <h3>Sender Email Preferences</h3>
      <p className="muted small" style={{ marginTop: 0 }}>Employees see emails as <b>“{f.sender_name.trim() || settings.company_name} &lt;{shownAddress || '…'}&gt;”</b>{f.reply_to.trim() ? <>, and replies go to <b>{f.reply_to.trim()}</b></> : null}.</p>
      <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
        <label>Sender name<input value={f.sender_name} onChange={set('sender_name')} placeholder={settings.company_name} /><span className="hint">Shown as the sender. Blank = company name.</span></label>
        {legacy && !own
          ? <label>Sender email<input type="email" value={f.sender_email} onChange={set('sender_email')} required /><span className="hint">Emails are sent from this address. It must be allowed by the server’s SMTP account.</span></label>
          : <label>Sender email<input value={shownAddress ?? ''} readOnly /><span className="hint">{own ? 'Your own mail account (change it below).' : 'The platform’s sending address. Connect your own mail account below to send from your company address.'}</span></label>}
        <label>Reply-to (optional)<input type="email" value={f.reply_to} onChange={set('reply_to')} /></label>
        <label>Official email domains<input value={f.email_domains} onChange={set('email_domains')} placeholder="company.com, company.in" /><span className="hint">Emails only go to addresses at these domains (never personal ones). Comma separated. Blank = the sender address’s domain.</span></label>
      </div>
      <div className="row" style={{ marginTop: 14, marginBottom: 0 }}><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
    <MailServer info={mail.data ?? null} loading={mail.loading} error={mail.error ?? null} reload={mail.reload} onSaved={() => router.refresh()} />
    </>
  );
}

interface MailInfo {
  ready: boolean;
  platform_sender: string | null;
  server: { provider: string | null; host: string; port: number; secure: boolean; username: string; from_email: string; verified_at: string | null } | null;
}

const PROVIDERS: Record<string, { label: string; host: string; port: number; secure: boolean; help: string }> = {
  gmail: { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, secure: true, help: 'Use an app password: Google Account → Security → 2-Step Verification → App passwords.' },
  outlook: { label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, secure: false, help: 'Your Microsoft 365 admin may need to allow “Authenticated SMTP” for this mailbox. With 2-step verification, use an app password.' },
  zoho: { label: 'Zoho Mail', host: 'smtp.zoho.in', port: 465, secure: true, help: 'Use smtp.zoho.com outside India. With 2-factor login, create an application-specific password in Zoho.' },
  other: { label: 'Other mail server', host: '', port: 587, secure: false, help: 'Ask your email provider for the SMTP host, port and login.' },
};

/** Connect the organization's own mailbox, so emails come from the company's own address. */
function MailServer({ info, loading, error, reload, onSaved }: { info: MailInfo | null; loading: boolean; error: string | null; reload: () => void; onSaved: () => void }) {
  const { notify } = useApp();
  const s = info?.server;
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ provider: 'gmail', host: PROVIDERS.gmail.host, port: String(PROVIDERS.gmail.port), secure: true, username: '', password: '', from_email: '' });
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const set = (k: 'host' | 'port' | 'username' | 'password' | 'from_email') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function start() {
    setFail(null);
    if (s) setF({ provider: s.provider ?? 'other', host: s.host, port: String(s.port), secure: s.secure, username: s.username, password: '', from_email: s.from_email });
    setEditing(true);
  }
  function pick(p: string) {
    const x = PROVIDERS[p];
    setF({ ...f, provider: p, host: x.host || f.host, port: String(x.port), secure: x.secure });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setFail(null);
    const r = await fetch('/api/org/mail', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...f, port: Number(f.port), from_email: f.from_email || f.username }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setFail(`${j.error ?? 'Could not save.'}${j.detail ? ` (${j.detail})` : ''}`); return; }
    notify('Connected — your emails now come from your own address');
    setEditing(false); reload(); onSaved();
  }
  async function disconnect() {
    if (!(await ask.confirm({ title: 'Disconnect your mail account?', tone: 'warn', confirmText: 'Disconnect', message: 'Emails will be sent from the platform’s address again (with your company name as the sender).' }))) return;
    await fetch('/api/org/mail', { method: 'DELETE' });
    notify('Disconnected'); reload(); onSaved();
  }

  return (
    <div className="card">
      <h3>Your mail server</h3>
      <p className="muted small" style={{ marginTop: 0 }}>Connect your company’s own mailbox (for example <b>hr@yourcompany.com</b>). Payslips, leave emails, login details and all other emails then go out from that address, through your own email account — employees only ever see your company’s address, and their replies arrive in that mailbox.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {info && !info.ready && <div className="note warn">The server is not ready to store mail passwords yet (MAIL_SECRET_KEY missing). Ask the platform administrator.</div>}
      {!loading && info && !editing && (s ? <>
        <div className="note ok">Connected: emails are sent from <b>{s.from_email}</b> via {s.host}:{s.port}{s.verified_at ? `, tested ${new Date(s.verified_at).toLocaleDateString()}` : ''}.</div>
        <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="btn" onClick={start}>Change</button>
          <button className="btn danger" onClick={disconnect}>Disconnect</button>
          <span className="muted small">Use “Send test email” on any template to see it arrive.</span>
        </div>
      </> : <div className="row" style={{ marginBottom: 0 }}><button className="btn primary" disabled={!info.ready} onClick={start}>Connect my mail account</button></div>)}
      {editing && (
        <form onSubmit={save}>
          <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <label>Email provider
              <select value={f.provider} onChange={e => pick(e.target.value)}>
                {Object.entries(PROVIDERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
              </select>
              <span className="hint">{PROVIDERS[f.provider]?.help}</span>
            </label>
            <label>Email address (login)<input type="email" value={f.username} onChange={set('username')} required placeholder="hr@yourcompany.com" autoComplete="off" /></label>
            <label>Password / app password<input type="password" value={f.password} onChange={set('password')} required={!s} placeholder={s ? 'Unchanged — type to replace' : ''} autoComplete="new-password" /><span className="hint">Stored encrypted. Never shown again.</span></label>
            <label>Send emails as<input type="email" value={f.from_email} onChange={set('from_email')} placeholder={f.username || 'Same as the login'} /><span className="hint">Usually the same as the login.</span></label>
            {f.provider === 'other' && <>
              <label>SMTP host<input value={f.host} onChange={set('host')} required placeholder="mail.yourcompany.com" /></label>
              <label>Port<input type="number" value={f.port} onChange={set('port')} required /></label>
              <label className="small" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={f.secure} onChange={e => setF({ ...f, secure: e.target.checked })} style={{ width: 'auto' }} /> TLS from the start (port 465)</label>
            </>}
          </div>
          {fail && <div className="note bad" style={{ marginTop: 12 }}>{fail}</div>}
          <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" disabled={busy}>{busy ? 'Testing the connection…' : 'Test and save'}</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
