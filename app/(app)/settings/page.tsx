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
    short_leave_per_month: String(settings.short_leave_per_month ?? 1), hr_email: settings.hr_email ?? '',
    office_lat: settings.office_lat != null ? String(settings.office_lat) : '',
    office_lng: settings.office_lng != null ? String(settings.office_lng) : '',
    office_radius_m: String(settings.office_radius_m ?? 100),
  });
  const [locating, setLocating] = useState(false);

  /** Fills the office location from this computer / phone's GPS (stand in the office when doing this). */
  function readHere() {
    if (!navigator.geolocation) { notify('This browser cannot read your location.', 'err'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => {
        setLocating(false);
        setF(x => ({ ...x, office_lat: p.coords.latitude.toFixed(6), office_lng: p.coords.longitude.toFixed(6) }));
        notify(`Location read (±${Math.round(p.coords.accuracy)} m). Check it on the map, then Save.`);
      },
      e => { setLocating(false); notify(e.message || 'Could not read your location.', 'err'); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }
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
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // Make a white / near-white background transparent (soft edge) so the logo sits cleanly on every PDF.
      const px = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < px.data.length; i += 4) {
        const low = Math.min(px.data[i], px.data[i + 1], px.data[i + 2]);
        if (low >= 250) px.data[i + 3] = 0;
        else if (low >= 225) px.data[i + 3] = Math.min(px.data[i + 3], Math.round(((250 - low) / 25) * 255));
      }
      ctx.putImageData(px, 0, 0);
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
    if (f.hr_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.hr_email.trim())) { notify('Enter a valid HR email address.', 'err'); return; }
    const hasLat = f.office_lat.trim() !== '', hasLng = f.office_lng.trim() !== '';
    const lat = Number(f.office_lat), lng = Number(f.office_lng), radius = Math.round(num(f.office_radius_m));
    if (hasLat !== hasLng || (hasLat && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180))) {
      notify('Enter both office latitude and longitude (e.g. 28.459497, 77.026638), or leave both blank.', 'err'); return;
    }
    if (radius < 20 || radius > 5000) { notify('Check-in radius must be between 20 and 5000 metres.', 'err'); return; }
    setBusy(true);
    const { error } = await supabaseBrowser().from('settings').update({
      office_lat: hasLat ? lat : null, office_lng: hasLng ? lng : null, office_radius_m: radius,
      company_name: f.company_name.trim(), company_address: f.company_address.trim(), footer_note: f.footer_note.trim(), logo,
      paid_leave_per_month: num(f.paid_leave_per_month),
      short_leave_per_month: Math.round(num(f.short_leave_per_month)), hr_email: f.hr_email.trim() || null, basic_pct: num(f.basic_pct), hra_pct: num(f.hra_pct), conveyance_pct: num(f.conveyance_pct),
    }).eq('id', settings.id);
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
            <span className="hint">The first absent day(s) each month are paid, not deducted. Also the paid leave an employee can apply for each month.</span>
          </label>
          <label>Short leaves per month
            <input type="number" min={0} step="1" value={f.short_leave_per_month} onChange={set('short_leave_per_month')} />
            <span className="hint">After these are used, employees can only apply for absent (unpaid) leave.</span>
          </label>
          <label>Leave requests go to (HR email)
            <input type="email" value={f.hr_email} onChange={set('hr_email')} placeholder={settings.reply_to || settings.sender_email} />
            <span className="hint">Plus the employee&apos;s team leader. Blank = the reply-to / sender address.</span>
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

      <div className="card">
        <h3>Mobile app check-in (office location)</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Employees can check in from the mobile app only when their phone&apos;s GPS puts them within this distance of the office.
          Checking in marks the day <b>Present</b> in attendance (days HR already marked are not changed).
        </p>
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <label>Latitude<input inputMode="decimal" value={f.office_lat} onChange={set('office_lat')} placeholder="28.459497" /></label>
          <label>Longitude<input inputMode="decimal" value={f.office_lng} onChange={set('office_lng')} placeholder="77.026638" /></label>
          <label>Check-in radius (metres)<input type="number" min={20} max={5000} step={10} value={f.office_radius_m} onChange={set('office_radius_m')} />
            <span className="hint">100 m is a good default. Phone GPS is usually accurate to 5–30 m outdoors.</span></label>
        </div>
        <div className="row" style={{ marginTop: 14, marginBottom: 0 }}>
          <button type="button" className="btn" disabled={locating} onClick={readHere}>{locating ? 'Reading location…' : 'Use my current location'}</button>
          {f.office_lat && f.office_lng && (
            <a className="btn" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${encodeURIComponent(f.office_lat)},${encodeURIComponent(f.office_lng)}`}>Check on map</a>
          )}
          <span className="muted small">Tip: in Google Maps, right-click the office and click the numbers to copy them.</span>
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
