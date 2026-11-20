'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';
import { num } from '@/lib/format';
import { fmtTime, toMinutes, windows } from '@/lib/late';
import { TimePicker } from '@/components/TimePicker';

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
    office_start_time: (settings.office_start_time ?? '').slice(0, 5), late_grace_until: (settings.late_grace_until ?? '').slice(0, 5),
    late_allowed_per_month: String(settings.late_allowed_per_month ?? 3),
    checkin_close_time: (settings.checkin_close_time ?? '11:00').slice(0, 5), second_half_start: (settings.second_half_start ?? '14:00').slice(0, 5),
    morning_short_back: (settings.morning_short_back ?? '12:30').slice(0, 5), checkin_extra_min: String(settings.checkin_extra_min ?? 60),
    half_day_per_month: String(settings.half_day_per_month ?? 0),
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
    const start = toMinutes(f.office_start_time), grace = toMinutes(f.late_grace_until);
    const lateAllowed = Math.round(num(f.late_allowed_per_month));
    if (f.office_start_time && start == null) { notify('Pick a valid office start time.', 'err'); return; }
    if (start != null && grace == null) { notify('Pick the late allowance time (latest check-in that can still count as Present).', 'err'); return; }
    if (start != null && grace != null && grace < start) { notify('The late allowance time cannot be before the office start time.', 'err'); return; }
    if (lateAllowed < 0 || lateAllowed > 31) { notify('Late check-ins allowed per month must be between 0 and 31.', 'err'); return; }
    const close = toMinutes(f.checkin_close_time), second = toMinutes(f.second_half_start), shortBack = toMinutes(f.morning_short_back);
    const extra = Math.round(num(f.checkin_extra_min));
    if (start != null) {
      if (close == null || second == null || shortBack == null) { notify('Pick all the office timing times.', 'err'); return; }
      if (grace != null && close < grace) { notify('Morning check-in cannot close before the late allowance time.', 'err'); return; }
      if (second < close) { notify('The second half cannot start before morning check-in closes.', 'err'); return; }
      if (shortBack < start) { notify('The morning short leave return time cannot be before the office start time.', 'err'); return; }
    }
    if (extra < 0 || extra > 240) { notify('The check-in allowance must be between 0 and 240 minutes.', 'err'); return; }
    if (num(f.half_day_per_month) < 0) { notify('Paid half days per month cannot be negative.', 'err'); return; }
    setBusy(true);
    const { error } = await supabaseBrowser().from('settings').update({
      office_lat: hasLat ? lat : null, office_lng: hasLng ? lng : null, office_radius_m: radius,
      office_start_time: start != null ? f.office_start_time : null, late_grace_until: start != null ? f.late_grace_until : null,
      late_allowed_per_month: lateAllowed,
      checkin_close_time: close != null ? f.checkin_close_time : null, second_half_start: second != null ? f.second_half_start : null,
      morning_short_back: shortBack != null ? f.morning_short_back : null, checkin_extra_min: extra,
      half_day_per_month: num(f.half_day_per_month),
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
          <label>Paid half days per month
            <input type="number" min={0} step="1" value={f.half_day_per_month} onChange={set('half_day_per_month')} />
            <span className="hint">Half-day leave (morning or evening) paid in full. 0 = every half day cuts half a day&apos;s pay. Late check-in half days are always half pay.</span>
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
        <h3>Office timing (check-in)</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Applied automatically when an employee checks in from the mobile app. Anyone who has not checked in when the second-half
          window closes is marked <b>Absent</b> (week offs, approved full-day leave and days HR already marked, e.g. a holiday, are skipped).
        </p>
        <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <div className="lbl">Office start time
            <TimePicker value={f.office_start_time} clearable placeholder="No timing rule" onChange={v => setF(x => ({ ...x, office_start_time: v, late_grace_until: v && !x.late_grace_until ? v : x.late_grace_until }))} />
            <span className="hint">The regular time. Clear it to turn all of this off.</span>
          </div>
          <div className="lbl">Late allowance until
            <TimePicker value={f.late_grace_until} disabled={!f.office_start_time} onChange={v => setF(x => ({ ...x, late_grace_until: v }))} />
            <span className="hint">Latest check-in that can still count as Present.</span>
          </div>
          <label>Late check-ins allowed per month
            <input type="number" min={0} max={31} step={1} value={f.late_allowed_per_month} onChange={set('late_allowed_per_month')} disabled={!f.office_start_time} />
            <span className="hint">Late check-ins beyond these are half days.</span>
          </label>
          <div className="lbl">Morning check-in closes at
            <TimePicker value={f.checkin_close_time} disabled={!f.office_start_time} onChange={v => setF(x => ({ ...x, checkin_close_time: v }))} />
            <span className="hint">After the late allowance time and up to this = Half day.</span>
          </div>
          <div className="lbl">Second half starts at
            <TimePicker value={f.second_half_start} disabled={!f.office_start_time} onChange={v => setF(x => ({ ...x, second_half_start: v }))} />
            <span className="hint">Check-in reopens for a half day; a morning half day ends here.</span>
          </div>
          <div className="lbl">Morning short leave: back by
            <TimePicker value={f.morning_short_back} disabled={!f.office_start_time} onChange={v => setF(x => ({ ...x, morning_short_back: v }))} />
            <span className="hint">When an employee on a morning short leave is due.</span>
          </div>
          <label>Extra check-in allowance (minutes)
            <input type="number" min={0} max={240} step={5} value={f.checkin_extra_min} onChange={set('checkin_extra_min')} disabled={!f.office_start_time} />
            <span className="hint">Added after the second half start and the short leave return time.</span>
          </label>
        </div>
        {(() => {
          const w = windows({
            office_start_time: f.office_start_time || null, late_grace_until: f.late_grace_until || null,
            late_allowed_per_month: Math.max(0, Math.round(num(f.late_allowed_per_month))), checkin_close_time: f.checkin_close_time || null,
            second_half_start: f.second_half_start || null, morning_short_back: f.morning_short_back || null, checkin_extra_min: Math.round(num(f.checkin_extra_min)),
          });
          if (!w) return null;
          const n = w.allowed;
          return (
            <div className="rule-sum">
              <div><span className="t">By {fmtTime(w.start)}</span><span className="pill ok">Present</span></div>
              {w.grace > w.start && <div><span className="t">{fmtTime(w.start)} – {fmtTime(w.grace)}</span>
                {n > 0 ? <><span className="pill warn">Present</span><span className="muted small">first {n} time{n > 1 ? 's' : ''} a month, then</span></> : null}
                <span className="pill bad">Half day</span></div>}
              {w.close > w.grace && <div><span className="t">{fmtTime(w.grace)} – {fmtTime(w.close)}</span><span className="pill bad">Half day</span></div>}
              {w.second > w.close && <div><span className="t">{fmtTime(w.close)} – {fmtTime(w.second)}</span><span className="pill gray">Check-in closed</span></div>}
              <div><span className="t">{fmtTime(w.second)} – {fmtTime(w.deadline)}</span><span className="pill bad">Half day</span><span className="muted small">second half</span></div>
              <div><span className="t">Not checked in by {fmtTime(w.deadline)}</span><span className="pill bad">Absent</span></div>
              <div><span className="t">Morning short leave</span><span className="pill blue">Short leave</span><span className="muted small">if checked in by {fmtTime(w.shortUntil)}</span></div>
              <div><span className="t">Morning half day</span><span className="pill bad">Half day</span><span className="muted small">if checked in by {fmtTime(w.deadline)}</span></div>
            </div>
          );
        })()}
        <button className="btn primary" style={{ marginTop: 14 }} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>

      <div className="card">
        <h3>Mobile app check-in (office location)</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Employees can check in from the mobile app only when their phone&apos;s GPS puts them within this distance of the office.
          Checking in marks the day in attendance under the office timing rules above (days HR already marked are not changed).
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
