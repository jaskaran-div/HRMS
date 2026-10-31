'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { num } from '@/lib/format';

export default function SettingsPage() {
  const { settings, isAdmin, notify } = useApp();
  const router = useRouter();
  const [f, setF] = useState({
    company_name: settings.company_name, company_address: settings.company_address, footer_note: settings.footer_note,
    paid_leave_per_month: String(settings.paid_leave_per_month), basic_pct: String(settings.basic_pct),
    hra_pct: String(settings.hra_pct), conveyance_pct: String(settings.conveyance_pct),
  });
  const [logo, setLogo] = useState<string | null>(settings.logo);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  if (!isAdmin) return <div className="note">Only admins can change company details and pay rules.</div>;

  const special = 100 - num(f.basic_pct) - num(f.hra_pct) - num(f.conveyance_pct);

  function pickLogo(file?: File) {
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 320 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      setLogo(c.toDataURL('image/png'));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => notify('Could not read that image.', 'err');
    img.src = url;
    if (fileRef.current) fileRef.current.value = '';
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (special < 0) { notify('Basic + HRA + Conveyance cannot be more than 100%.', 'err'); return; }
    if (!f.company_name.trim()) { notify('Company name is required.', 'err'); return; }
    setBusy(true);
    const { error } = await supabaseBrowser().from('settings').update({
      company_name: f.company_name.trim(), company_address: f.company_address.trim(), footer_note: f.footer_note.trim(), logo,
      paid_leave_per_month: num(f.paid_leave_per_month), basic_pct: num(f.basic_pct), hra_pct: num(f.hra_pct), conveyance_pct: num(f.conveyance_pct),
    }).eq('id', 1);
    setBusy(false);
    if (error) { notify(error.message, 'err'); return; }
    notify('Saved');
    router.refresh();
  }

  return (
    <form onSubmit={save}>
      <div className="card">
        <h3>Company (printed on every payslip)</h3>
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
          <label>Company name<input value={f.company_name} onChange={set('company_name')} required /></label>
          <label>Address<input value={f.company_address} onChange={set('company_address')} /></label>
          <label>Footer line<input value={f.footer_note} onChange={set('footer_note')} /></label>
        </div>
        <div className="row" style={{ marginTop: 16, marginBottom: 0 }}>
          {logo ? <img src={logo} alt="Logo" style={{ maxHeight: 56, maxWidth: 160, border: '1px solid var(--line)', borderRadius: 8, padding: 4 }} /> : <span className="pill gray">No logo</span>}
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Upload logo</button>
          {logo && <button type="button" className="btn danger" onClick={() => setLogo(null)}>Remove</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => pickLogo(e.target.files?.[0])} />
          <span className="muted small">PNG or JPG — shown top-left on the sidebar and the payslip.</span>
        </div>
      </div>

      <div className="card">
        <h3>Pay rules</h3>
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <label>Paid leave per month (days)
            <input type="number" min={0} step="0.5" value={f.paid_leave_per_month} onChange={set('paid_leave_per_month')} />
            <span className="hint">The first absent day(s) each month are paid, not deducted.</span>
          </label>
        </div>
        <h3 style={{ marginTop: 18 }}>Salary structure on the payslip</h3>
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
          <label>Basic %<input type="number" min={0} max={100} step="0.01" value={f.basic_pct} onChange={set('basic_pct')} /></label>
          <label>House Rent Allowance %<input type="number" min={0} max={100} step="0.01" value={f.hra_pct} onChange={set('hra_pct')} /></label>
          <label>Conveyance %<input type="number" min={0} max={100} step="0.01" value={f.conveyance_pct} onChange={set('conveyance_pct')} /></label>
          <label>Special Allowance %<input value={special.toFixed(2)} readOnly /><span className="hint">Whatever is left</span></label>
        </div>
        <p className="muted small">Changing these affects payslips generated from now on. Already generated payslips stay as they were until you regenerate them.</p>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
