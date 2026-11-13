'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/ui';

interface Info { email: string; full_name: string; role: string; org: string; inviter: string | null }

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (r.ok) setInfo(j as Info); else setError(j.error ?? 'This invitation is not valid.');
    }, () => setError('Could not reach the server.'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== again) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    const r = await fetch('/api/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: pw }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? 'Could not create your account.'); setBusy(false); return; }
    const { error: signErr } = await supabaseBrowser().auth.signInWithPassword({ email: j.email, password: pw });
    window.location.replace(signErr ? '/login?invited=1' : '/');
  }

  return (
    <div className="login-wrap">
      <div className="public-card">
        {!info && !error && <p className="muted"><Spinner size={16} /> Checking your invitation…</p>}
        {!info && error && <><h1>Invitation not valid</h1><p className="note bad">{error}</p><p className="foot"><Link href="/login">Log in</Link></p></>}
        {info && <>
          <h1>Join {info.org}</h1>
          <p className="sub">{info.inviter ? `${info.inviter} invited you` : 'You are invited'} as <b>{info.role}</b>. Choose a password for <b>{info.email}</b>. You will use the same email and password on the web and in the mobile app.</p>
          {error && <p className="err-line" role="alert"><Icon name="alert" size={16} />{error}</p>}
          <form onSubmit={submit}>
            <label>Password<input type="password" value={pw} onChange={e => setPw(e.target.value)} minLength={10} required autoFocus autoComplete="new-password" /><span className="hint muted small">At least 10 characters</span></label>
            <label>Repeat password<input type="password" value={again} onChange={e => setAgain(e.target.value)} required autoComplete="new-password" /></label>
            <button className="btn primary" disabled={busy}>{busy ? <><Spinner size={16} /> Creating your account…</> : 'Accept and continue'}</button>
          </form>
        </>}
      </div>
    </div>
  );
}

export default function InvitePage() {
  return <Suspense><Accept /></Suspense>;
}
