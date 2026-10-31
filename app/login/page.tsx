'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { toEmail } from '@/lib/username';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: toEmail(username), password });
    if (error) {
      setError('Wrong username or password.');
      setBusy(false);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="logo">HR</div>
        <h1>HR Portal</h1>
        <p className="sub">Log in with your username and password</p>
        <label>Username
          <input value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" required />
        </label>
        <label>Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="err" style={{ marginTop: 0 }}>{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </div>
  );
}
