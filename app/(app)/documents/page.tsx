'use client';

import { ErrorBox } from '@/components/ui';
import { useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fetchAll } from '@/lib/fetch-all';
import { useLoad } from '@/lib/use-load';
import { fmtDate } from '@/lib/dates';
import { fileSize } from '@/lib/format';
import type { DocumentRow, Employee } from '@/lib/types';

import { ask } from '@/components/Dialog';
type Emp = Pick<Employee, 'id' | 'emp_code' | 'name' | 'archived_at'>;
const CATEGORIES = ['Terms & conditions', 'Policy', 'Offer letter', 'Appointment letter', 'ID proof', 'Address proof', 'Education', 'Experience letter', 'Warning letter', 'Other'];
const MAX = 4 * 1024 * 1024;

export default function DocumentsPage() {
  const { canEdit, driveReady, notify, mailReady } = useApp();
  const [owner, setOwner] = useState(''); // '' = company documents, else employee id
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [visible, setVisible] = useState(true);
  const [tell, setTell] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const sb = supabaseBrowser();
    const [emps, docs] = await Promise.all([
      fetchAll<Emp>((a, b) => sb.from('employees').select('id, emp_code, name, archived_at').order('name').range(a, b)),
      owner
        ? sb.from('documents').select('*').eq('employee_id', owner).order('created_at', { ascending: false })
        : sb.from('documents').select('*').is('employee_id', null).order('created_at', { ascending: false }),
    ]);
    if (docs.error) throw new Error(docs.error.message);
    return { emps, docs: (docs.data ?? []) as DocumentRow[] };
  }, [owner]);
  const emps = useMemo(() => data?.emps ?? [], [data]);
  const docs = data?.docs ?? [];
  const who = emps.find(e => e.id === owner);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { notify('Choose a file.', 'err'); return; }
    if (file.size > MAX) { notify('The file is too large (4 MB at most).', 'err'); return; }
    setBusy(true);
    const fd = new FormData();
    fd.set('file', file); fd.set('title', title || file.name.replace(/\.[^.]+$/, '')); fd.set('category', category);
    fd.set('employee_id', owner); fd.set('visible', visible ? '1' : '0'); fd.set('notify', tell && mailReady ? '1' : '0');
    const res = await fetch('/api/documents', { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { notify(j.error ?? `Upload failed (${res.status})`, 'err'); return; }
    if (j.mail && !j.mail.ok) notify(`Uploaded, but the email was not sent: ${j.mail.error}`, 'err');
    else notify(j.mail?.ok ? `Uploaded and emailed to ${j.mail.to.length === 1 ? j.mail.to[0] : `${j.mail.to.length} people`}` : 'Uploaded');
    setTitle(''); setFile(null); if (fileRef.current) fileRef.current.value = '';
    reload();
  }

  async function remove(d: DocumentRow) {
    if (!(await ask.confirm({ title: `Delete "${d.title}"?`, danger: true, confirmText: 'Delete', message: 'The file is moved to the Google Drive trash.' }))) return;
    const res = await fetch(`/api/documents/${d.id}`, { method: 'DELETE' });
    if (!res.ok) { notify((await res.json().catch(() => ({}))).error ?? 'Could not delete', 'err'); return; }
    notify('Deleted'); reload();
  }

  async function toggle(d: DocumentRow) {
    const res = await fetch(`/api/documents/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: !d.visible_to_employee }) });
    if (!res.ok) { notify('Could not save', 'err'); return; }
    reload();
  }

  return (
    <>
      <div className="page-h">
        <select value={owner} onChange={e => setOwner(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">🏢 Company documents (everyone sees these)</option>
          {emps.map(e => <option key={e.id} value={e.id}>👤 {e.name} ({e.emp_code}){e.archived_at ? ' — inactive' : ''}</option>)}
        </select>
      </div>
      {!driveReady && (
        <div className="note warn" style={{ marginBottom: 12 }}>
          Google Drive storage is not set up yet. Add <b>GOOGLE_DRIVE_FOLDER_ID</b> and either the service-account keys or the OAuth keys
          (see <code>.env.example</code>) to the server environment, then restart.
        </div>
      )}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {canEdit && (
        <div className="card">
          <h3>Upload {who ? `for ${who.name}` : 'a company document'}</h3>
          <form onSubmit={upload}>
            <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
              <label>File *<input ref={fileRef} type="file" required onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <span className="hint">{file ? fileSize(file.size) : 'PDF, image, Word… up to 4 MB'}</span></label>
              <label>Title<input value={title} maxLength={200} placeholder={file?.name.replace(/\.[^.]+$/, '') ?? 'e.g. Leave policy 2026'} onChange={e => setTitle(e.target.value)} /></label>
              <label>Category
                <input list="doc-cats" value={category} onChange={e => setCategory(e.target.value)} placeholder="Pick or type" />
                <datalist id="doc-cats">{CATEGORIES.map(c => <option key={c} value={c} />)}</datalist>
              </label>
            </div>
            <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
              <button className="btn primary" disabled={busy || !driveReady || !file}>{busy ? 'Uploading…' : 'Upload'}</button>
              {who && (
                <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} /> {who.name} can see it in their account
                </label>
              )}
              {mailReady && (who ? visible : true) && (
                <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={tell} onChange={e => setTell(e.target.checked)} /> {who ? `Email ${who.name.split(' ')[0]} about it` : 'Email all employees about it'}
                </label>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h3>{who ? `${who.name}'s documents` : 'Company documents'}</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Title</th><th>Category</th><th>File</th><th>Uploaded</th>{who && <th>Employee sees it</th>}<th /></tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td><b>{d.title}</b></td><td>{d.category}</td>
                  <td className="muted small">{d.file_name}{d.size_bytes ? ` · ${fileSize(d.size_bytes)}` : ''}</td>
                  <td className="muted small">{fmtDate(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}</td>
                  {who && <td>{canEdit
                    ? <button className={`btn sm ${d.visible_to_employee ? '' : 'danger'}`} onClick={() => toggle(d)}>{d.visible_to_employee ? 'Yes — hide' : 'Hidden — show'}</button>
                    : d.visible_to_employee ? 'Yes' : 'No'}</td>}
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <a className="btn sm" href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">Open</a>{' '}
                    <a className="btn sm" href={`/api/documents/${d.id}?download=1`}>Download</a>{' '}
                    {canEdit && <button className="btn sm danger" onClick={() => remove(d)}>Delete</button>}
                  </td>
                </tr>
              ))}
              {!docs.length && !loading && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 26 }}>No documents yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
