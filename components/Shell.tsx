'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from './AppContext';
import { supabaseBrowser } from '@/lib/supabase/client';

const NAV = [
  { href: '/', icon: '📊', label: 'Dashboard' },
  { href: '/employees', icon: '👥', label: 'Employees' },
  { href: '/attendance', icon: '🗓️', label: 'Attendance' },
  { href: '/payroll', icon: '💰', label: 'Payroll & Payslips' },
  { href: '/import', icon: '📤', label: 'Import / Export', edit: true },
];
const ADMIN_NAV = [
  { href: '/settings', icon: '⚙️', label: 'Company & Rules' },
  { href: '/users', icon: '🔑', label: 'User Access' },
  { href: '/activity', icon: '📜', label: 'Activity Log' },
];

const TITLES: [string, string][] = [
  ['/employees', 'Employees'], ['/attendance', 'Attendance'], ['/payroll', 'Payroll & Payslips'], ['/import', 'Import / Export'],
  ['/settings', 'Company & Rules'], ['/users', 'User Access'], ['/activity', 'Activity Log'],
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { profile, settings, isAdmin, canEdit } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ emp_code: string; name: string }[]>([]);
  const [missing, setMissing] = useState('');

  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const title = path === '/' ? 'Dashboard' : TITLES.find(([p]) => path.startsWith(p))?.[1] ?? '';

  async function suggest(text: string) {
    setQ(text); setMissing('');
    const t = text.trim().replace(/[,()*%\\]/g, '');
    if (!t) { setHits([]); return; }
    const { data } = await supabaseBrowser().from('employees').select('emp_code, name')
      .or(`emp_code.ilike.*${t}*,name.ilike.*${t}*`).is('archived_at', null).order('emp_code').limit(6);
    setHits((data as { emp_code: string; name: string }[]) ?? []);
  }

  async function go(code?: string) {
    const c = (code ?? q).trim().toUpperCase();
    if (!c) return;
    const { data } = await supabaseBrowser().from('employees').select('emp_code').eq('emp_code', c).maybeSingle();
    if (!data) { setMissing(`No employee with ID "${c}"`); setHits([]); return; }
    setHits([]); setQ(''); setMissing('');
    router.push(`/employees/${encodeURIComponent(data.emp_code)}`);
  }

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className={`logo ${settings.logo ? 'has-img' : ''}`}>
            {settings.logo ? <img src={settings.logo} alt="" /> : 'HR'}
          </div>
          <div><b>{settings.company_name}</b><small>HR Portal</small></div>
        </div>
        {NAV.filter(n => !n.edit || canEdit).map(n => (
          <Link key={n.href} href={n.href} className={`nav ${active(n.href) ? 'on' : ''}`}><span className="ic">{n.icon}</span>{n.label}</Link>
        ))}
        {isAdmin && <div className="nav-h">Admin</div>}
        {isAdmin && ADMIN_NAV.map(n => (
          <Link key={n.href} href={n.href} className={`nav ${active(n.href) ? 'on' : ''}`}><span className="ic">{n.icon}</span>{n.label}</Link>
        ))}
        <div className="side-foot">
          <div className="who">{profile.full_name}</div>
          <div className="muted small" style={{ marginBottom: 8 }}>{profile.username} · {profile.role}</div>
          <Link href="/change-password" className="small">Change password</Link>
          <form action="/api/logout" method="post" style={{ marginTop: 6 }}>
            <button className="btn sm" style={{ width: '100%', justifyContent: 'center' }}>Log out</button>
          </form>
        </div>
      </aside>

      <div className="content">
        <div className="topbar">
          <h1>{title}</h1>
          <div className="search">
            <input
              value={q} placeholder="Find an employee by ID — e.g. ISFTD0007" autoComplete="off"
              onChange={e => suggest(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && go()}
              onBlur={() => setTimeout(() => setHits([]), 150)}
            />
            <button className="btn primary" onClick={() => go()}>Search</button>
            {(hits.length > 0 || missing) && (
              <div className="suggest">
                {hits.map(h => (
                  <div key={h.emp_code} onMouseDown={() => go(h.emp_code)}><b>{h.emp_code}</b><span className="muted">{h.name}</span></div>
                ))}
                {missing && <div style={{ cursor: 'default' }} className="err">{missing}</div>}
              </div>
            )}
          </div>
        </div>
        <main>{children}</main>
      </div>
    </div>
  );
}
