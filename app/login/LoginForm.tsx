'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { toEmail } from '@/lib/username';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/ui';
import { initials } from '@/lib/format';

export function Logo({ company, logo, className = 'logo' }: { company: string; logo: string | null; className?: string }) {
  return <div className={`${className} ${logo ? 'has-img' : ''}`}>{logo ? <img src={logo} alt={company} /> : initials(company)}</div>;
}

export function LoginForm({ company, logo, notice }: { company: string; logo: string | null; notice?: string | null }) {
  const [entering, setEntering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      // an email (organization owners, invited people) is used as is; a username maps to username@LOGIN_DOMAIN
      const id = username.trim();
      const { error } = await supabaseBrowser().auth.signInWithPassword({ email: id.includes('@') ? id.toLowerCase() : toEmail(id), password });
      if (error) {
        setError(/fetch|network/i.test(error.message) ? 'Could not reach the server. Check your internet connection.'
          : /not confirmed/i.test(error.message) ? 'Verify your email first — check your inbox for the link (or register again to resend it).'
          : 'Wrong email / username or password.');
        setBusy(false);
        return;
      }
      // Full page load (not an in-app switch): the loader stays on screen until the panel is ready,
      // instead of a blank page while the server checks the login and redirects to the right panel.
      setEntering(true);
      window.location.replace('/');
    } catch {
      setError('Could not reach the server. Check your internet connection.');
      setBusy(false);
    }
  }

  if (entering) return (
    <div className="boot" role="status" aria-label="Loading">
      <Spinner size={34} />
      <span>Logging in to {company}…</span>
    </div>
  );

  return (
    <div className="login-wrap">
      <div className="login-shell">
        <div className="login-art">
          <div className="brandmark">
            <Logo company={company} logo={logo} />
            <b>{company}</b>
          </div>
          <div>
            <h2>Everything HR,<br />in one place.</h2>
            <p>Attendance, leave, payslips and documents — for HR, team leaders and every employee.</p>
            <ul>
              <li><span><Icon name="calendar" size={16} /></span>Attendance &amp; leave in a few clicks</li>
              <li><span><Icon name="receipt" size={16} /></span>Payslips ready to download</li>
              <li><span><Icon name="lock" size={16} /></span>Each person sees only what is theirs</li>
            </ul>
          </div>
          <small style={{ opacity: 0.75, position: 'relative' }}>© {new Date().getFullYear()} {company}</small>
        </div>

        <form className="login" onSubmit={submit}>
          <Logo company={company} logo={logo} />
          <h1>Welcome back</h1>
          <p className="sub">Log in to {company} with your email or username and password.</p>
          {notice && !error && <p className="note" role="status">{notice}</p>}
          {error && <p className="err-line" role="alert"><Icon name="alert" size={16} />{error}</p>}
          <label>Email or username
            <input value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="you@company.com" />
          </label>
          <label>Password
            <div className="pw-field">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required placeholder="Your password" />
              <button type="button" className="pw-eye" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'} tabIndex={-1}>
                <Icon name={showPw ? 'eyeOff' : 'eye'} size={17} />
              </button>
            </div>
          </label>
          <button className="btn primary" disabled={busy}>{busy ? <><Spinner size={16} /> Logging in…</> : 'Log in'}</button>
          <p className="login-foot">Forgot your password? Ask HR to set a new one.</p>
          <p className="login-foot">New organization? <a href="/register">Register</a> · <a href="/contact-sales">Contact Sales</a></p>
        </form>
      </div>
    </div>
  );
}
