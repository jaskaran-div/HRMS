'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/ui';
import { PricingCard, planAmount } from '@/components/PricingCard';
import { PLAN } from '@/lib/billing/catalog';
import { startCheckout, TOKEN_KEY } from '@/lib/billing/start-checkout';

function Steps({ at }: { at: 1 | 2 | 3 }) {
  const s = (n: number, label: string) => <span className={n === at ? 'on' : n < at ? 'done' : ''}><i>{n < at ? '✓' : n}</i>{label}</span>;
  return <div className="steps">{s(1, 'Organization details')}{s(2, 'Payment')}{s(3, 'Verify email & log in')}</div>;
}

/** Web-only organization registration. The registrant becomes the organization's owner. */
export function RegisterForm() {
  const [f, setF] = useState({ org_name: '', full_name: '', email: '', password: '', phone: '', country: '', employees: '', website: '' });
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ emailed: boolean; mailError?: string; token?: string } | null>(null);
  const [payLater, setPayLater] = useState(false);
  const [payError, setPayError] = useState('');
  const [paying, setPaying] = useState(false);
  const [resent, setResent] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== again) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? 'Could not register.'); setBusy(false); return; }
      const token: string | undefined = j.checkoutToken;
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      setDone({ emailed: !!j.emailed, mailError: j.mailError, token });
      // came from the pricing card ("Get started"): go straight to payment
      if (token && new URLSearchParams(window.location.search).get('plan')) { await pay(token); return; }
    } catch {
      setError('Could not reach the server. Check your internet connection.');
    }
    setBusy(false);
  }

  async function pay(token = done?.token) {
    if (!token) { setPayError('Log in to subscribe from Billing.'); return; }
    setPaying(true); setPayError('');
    setPayError(await startCheckout(token));
    setPaying(false);
    setBusy(false);
  }

  async function resend() {
    const r = await fetch('/api/register/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email }) });
    const j = await r.json().catch(() => ({}));
    setResent(j.message ?? j.error ?? 'Sent.');
  }

  if (done && !payLater) return (
    <div className="login-wrap">
      <div className="public-card">
        <Steps at={2} />
        <h1>Subscribe to start using {f.org_name || 'your organization'}</h1>
        <p className="sub">Your organization is created. Pay now to activate it — it takes a minute on Stripe’s secure page.</p>
        {payError && <p className="err-line" role="alert"><Icon name="alert" size={16} />{payError}</p>}
        <PricingCard compact>
          <button className="btn primary" onClick={() => pay()} disabled={paying || !done.token}>{paying ? <><Spinner size={16} /> Opening secure payment…</> : 'Subscribe & pay'}</button>
          <button className="btn" onClick={() => setPayLater(true)} disabled={paying}>I’ll pay later — take me to login</button>
        </PricingCard>
        <div className="next-box">
          <b>What happens next</b>
          <ol>
            <li>Pay on Stripe (card, UPI or netbanking where available). You come back here automatically.</li>
            <li>Open the verification link we emailed to <b>{f.email}</b>.</li>
            <li><Link href="/login">Log in</Link> with that email and your password, then invite your team.</li>
          </ol>
        </div>
        <p className="foot">Payments are processed by Stripe; we never see your card. Questions? <Link href="/contact-sales">Contact Sales</Link></p>
      </div>
    </div>
  );

  if (done) return (
    <div className="login-wrap">
      <div className="public-card">
        <Steps at={3} />
        <div className="result-icon wait"><Icon name="mail" size={26} /></div>
        <h1>Check your inbox</h1>
        <p className="sub">We sent a verification link to <b>{f.email}</b>. Open it to confirm your email, then log in. Your organization stays waiting for payment — subscribe any time from <b>Billing</b> after logging in.</p>
        {!done.emailed && <p className="note warn">{done.mailError}</p>}
        <div className="row">
          <button className="btn" onClick={resend}>Resend the link</button>
          <Link className="btn primary" href="/login">Go to login</Link>
        </div>
        {resent && <p className="muted small">{resent}</p>}
        {done.token && <p className="foot">Changed your mind? <button className="linkish" onClick={() => setPayLater(false)}>Pay now instead</button></p>}
      </div>
    </div>
  );

  return (
    <div className="login-wrap reg-wrap">
      <div className="public-card">
        <Link href="/pricing" className="back-link"><Icon name="chevronLeft" size={16} />Back to pricing</Link>
        <Steps at={1} />
        <h1>Register your organization</h1>
        <p className="sub">You become the organization’s owner. Next you pay securely with Stripe, verify your email, and log in to invite your HR team and employees.</p>
        {error && <p className="err-line" role="alert"><Icon name="alert" size={16} />{error}</p>}
        <form onSubmit={submit}>
          <label>Organization name<input value={f.org_name} onChange={set('org_name')} required minLength={2} autoFocus /></label>
          <label>Your full name<input value={f.full_name} onChange={set('full_name')} required minLength={2} autoComplete="name" /></label>
          <label>Work email<input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
          <div className="mgrid">
            <label>Password<input type="password" value={f.password} onChange={set('password')} required minLength={10} autoComplete="new-password" /><span className="hint">At least 10 characters</span></label>
            <label>Repeat password<input type="password" value={again} onChange={e => setAgain(e.target.value)} required autoComplete="new-password" /></label>
          </div>
          <div className="mgrid">
            <label>Phone (optional)<input value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
            <label>Country (optional)<input value={f.country} onChange={set('country')} autoComplete="country-name" /></label>
            <label>Employees (approx.)<input type="number" min={1} value={f.employees} onChange={set('employees')} /></label>
          </div>
          {/* honeypot: hidden from people, filled by bots */}
          <div className="hp" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
          <button className="btn primary" disabled={busy}>{busy ? <><Spinner size={16} /> Creating…</> : 'Create organization & continue'}</button>
        </form>
        <p className="foot">Already registered? <Link href="/login">Log in</Link> · Large team or special needs? <Link href="/contact-sales">Contact Sales</Link></p>
      </div>
      <aside className="reg-plan">
        <span className="price-badge">Your plan</span>
        <h3>{PLAN.name}</h3>
        <div className="price-big">{planAmount({ amount: PLAN.amount, currency: PLAN.currency, interval: PLAN.interval })}<small> / month</small></div>
        <ul className="price-list">{PLAN.highlights.slice(0, 5).map(h => <li key={h}><Icon name="check" size={16} />{h}</li>)}</ul>
        <p className="muted small">Cancel any time. You’re only charged after this form, on Stripe’s secure page.</p>
      </aside>
    </div>
  );
}
