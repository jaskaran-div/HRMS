'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { toEmail } from '@/lib/username';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/ui';
import { initials } from '@/lib/format';

export function Logo({ company, logo, className = 'logo' }: { company: string; logo: string | null; className?: string }) {
  return <div className={`${className} ${logo ? 'has-img' : ''}`}>{logo ? <img src={logo} alt={company} /> : initials(company)}</div>;
}

export function LoginForm({ company, logo }: { company: string; logo: string | null }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { error } = await supabaseBrowser().auth.signInWithPassword({ email: toEmail(username.trim()), password });
      if (error) {
        setError(/fetch|network/i.test(error.message) ? 'Could not reach the server. Check your internet connection.' : 'Wrong username or password.');
        setBusy(false);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your internet connection.');
      setBusy(false);
    }
  }

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
          <p className="sub">Log in to {company} HR Portal with your username and password.</p>
          {error && <p className="err-line" role="alert"><Icon name="alert" size={16} />{error}</p>}
          <label>Username
            <input value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="e.g. isftd0007" />
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
        </form>
      </div>
    </div>
  );
}
