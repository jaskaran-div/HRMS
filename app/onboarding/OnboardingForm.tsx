'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';

type F = Record<'company_name' | 'company_address' | 'hr_email' | 'email_domains' | 'paid_leave_per_month' | 'short_leave_per_month' | 'office_lat' | 'office_lng' | 'office_radius_m', string>;

export function OnboardingForm({ initial }: { initial: F }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await fetch('/api/org/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? 'Could not save.'); setBusy(false); return; }
    window.location.replace('/users');
  }

  return (
    <form onSubmit={submit}>
      {error && <p className="err-line" role="alert"><Icon name="alert" size={16} />{error}</p>}
      <label>Company name (on payslips and emails)<input value={f.company_name} onChange={set('company_name')} required /></label>
      <label>Company address<input value={f.company_address} onChange={set('company_address')} /></label>
      <div className="mgrid">
        <label>HR inbox for leave requests<input type="email" value={f.hr_email} onChange={set('hr_email')} /></label>
        <label>Official email domains<input value={f.email_domains} onChange={set('email_domains')} placeholder="company.com" /></label>
      </div>
      <div className="mgrid">
        <label>Paid leave / month<input type="number" min={0} max={31} step={0.5} value={f.paid_leave_per_month} onChange={set('paid_leave_per_month')} /></label>
        <label>Short leave / month<input type="number" min={0} max={31} value={f.short_leave_per_month} onChange={set('short_leave_per_month')} /></label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Office location for mobile check-in (optional — employees can check in only within the radius):</p>
      <div className="mgrid">
        <label>Latitude<input value={f.office_lat} onChange={set('office_lat')} placeholder="28.4595" /></label>
        <label>Longitude<input value={f.office_lng} onChange={set('office_lng')} placeholder="77.0266" /></label>
        <label>Radius (m)<input type="number" min={20} max={5000} value={f.office_radius_m} onChange={set('office_radius_m')} /></label>
      </div>
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save and invite my team'}</button>
    </form>
  );
}
