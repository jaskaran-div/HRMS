'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { Icon } from './Icon';
import { TopProgress } from './ui';
import { initials } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';

export interface NavItem { href: string; icon: string; label: string; sub: string; edit?: boolean }

const NAV: NavItem[] = [
  { href: '/', icon: 'home', label: 'Dashboard', sub: 'Your company at a glance.' },
  { href: '/employees', icon: 'users', label: 'Employees', sub: 'Everyone on the payroll, their details and documents.' },
  { href: '/attendance', icon: 'calendar', label: 'Attendance', sub: 'Mark attendance day by day, or upload the monthly sheet.' },
  { href: '/checkins', icon: 'clock', label: 'App check-ins', sub: 'Who checked in from the mobile app, when, and how far from the office.' },
  { href: '/payroll', icon: 'wallet', label: 'Payroll & Payslips', sub: 'Check the numbers, generate payslips and email them.' },
  { href: '/leaves', icon: 'plane', label: 'Leave', sub: 'Leave requests from employees — approve, decline and history.' },
  { href: '/teams', icon: 'network', label: 'Teams & hierarchy', sub: 'Who reports to whom. Team leaders see their team.' },
  { href: '/documents', icon: 'folder', label: 'Documents', sub: 'Company documents and each employee’s files.' },
  { href: '/import', icon: 'upload', label: 'Import / Export', sub: 'Bring employees in from a sheet, or export everything.', edit: true },
];
const ADMIN_NAV: NavItem[] = [
  { href: '/settings', icon: 'building', label: 'Company & Rules', sub: 'Company details, logo, pay and leave rules.' },
  { href: '/customisations', icon: 'mail', label: 'Customisations', sub: 'Email templates and the sender address.' },
  { href: '/users', icon: 'key', label: 'User Access', sub: 'Logins for HR, team leaders and employees.' },
  { href: '/activity', icon: 'history', label: 'Activity Log', sub: 'Who changed what, and when.' },
];
const EXTRA: Omit<NavItem, 'icon'>[] = [
  { href: '/change-password', label: 'Change password', sub: '' },
];

const ROLE_NAME: Record<string, string> = { admin: 'HR · Admin', editor: 'HR · Editor', viewer: 'HR · Viewer', team_lead: 'Team leader', employee: 'Employee' };

/** Remembers whether the sidebar is collapsed (per browser). */
function useCollapsed(): [boolean, () => void] {
  const [c, setC] = useState(false);
  useEffect(() => { try { setC(localStorage.getItem('hr.sidebar') === 'collapsed'); } catch { /* private mode */ } }, []);
  return [c, () => setC(v => { try { localStorage.setItem('hr.sidebar', v ? 'open' : 'collapsed'); } catch { /* ignore */ } return !v; })];
}

/** Sidebar + top bar shared by the HR app and the employee panel. */
export function Frame({ nav, adminNav = [], panelName, search, bell, menu, children }: {
  nav: NavItem[]; adminNav?: NavItem[]; panelName: string; search?: React.ReactNode;
  bell?: { count: number; href: string; label: string } | null; menu: React.ReactNode; children: React.ReactNode;
}) {
  const { profile, settings } = useApp();
  const path = usePathname();
  const [collapsed, toggle] = useCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const home = nav[0]?.href ?? '/';

  const active = (href: string) => (href === home ? path === home : path === href || path.startsWith(href + '/'));
  const all = [...nav, ...adminNav];
  const page = [...all].sort((a, b) => b.href.length - a.href.length).find(n => active(n.href)) ?? EXTRA.find(n => path.startsWith(n.href));

  useEffect(() => { setMobileOpen(false); setMenuOpen(false); }, [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const off = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menuOpen]);

  const link = (n: NavItem) => (
    <Link key={n.href} href={n.href} className={`nav ${active(n.href) ? 'on' : ''}`} title={collapsed ? n.label : undefined}>
      <Icon name={n.icon} size={19} /><span className="lbl">{n.label}</span>
    </Link>
  );

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <TopProgress />
      <aside>
        <div className="brand">
          <div className={`logo ${settings.logo ? 'has-img' : ''}`}>{settings.logo ? <img src={settings.logo} alt="" /> : initials(settings.company_name)}</div>
          <div className="lbl"><b>{settings.company_name}</b><small>{panelName}</small></div>
          <button className="icon-btn collapse-btn" onClick={toggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
            <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
          </button>
        </div>
        <div className="nav-h">General</div>
        {nav.map(link)}
        {adminNav.length > 0 && <div className="nav-h">Admin</div>}
        {adminNav.map(link)}
      </aside>
      <div className="scrim" onClick={() => setMobileOpen(false)} />

      <div className="content">
        <div className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          {search}
          <span className="sp" />
          {bell && (
            <Link href={bell.href} className="icon-btn bell" title={bell.label} aria-label={bell.label}>
              <Icon name="bell" size={18} />{bell.count > 0 && <span className="badge">{bell.count > 99 ? '99+' : bell.count}</span>}
            </Link>
          )}
          <div className="userchip-wrap" ref={menuRef}>
            <button className="userchip" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen}>
              <span className="av">{initials(profile.full_name)}</span>
              <span className="uc-txt"><b>{profile.full_name}</b><small>{ROLE_NAME[profile.role] ?? profile.role}</small></span>
              <Icon name="chevronDown" size={16} />
            </button>
            {menuOpen && <div className="menu">{menu}</div>}
          </div>
        </div>
        <main>
          {page && page.href !== home && (
            <div className="pagehead">
              <h1>{page.label}</h1>
              {page.sub && <p>{page.sub}</p>}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Items at the bottom of the user menu (password, log out). */
export function MenuFoot() {
  return (
    <>
      <Link href="/change-password" className="mi-row"><Icon name="lock" size={16} /> Change password</Link>
      <form action="/api/logout" method="post"><button className="mi-row danger"><Icon name="logout" size={16} /> Log out</button></form>
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, canEdit } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ emp_code: string; name: string }[]>([]);
  const [missing, setMissing] = useState('');
  const [pending, setPending] = useState(0);

  // leave requests waiting for HR (refreshed on every page change)
  useEffect(() => {
    supabaseBrowser().from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('hr_status', 'pending')
      .then(({ count }: { count: number | null }) => setPending(count ?? 0), () => setPending(0));
  }, [path]);

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
    if (!data) {
      if (hits.length === 1) return go(hits[0].emp_code);
      setMissing(hits.length ? 'Pick one of the matches above' : `No employee matches "${q.trim()}"`); return;
    }
    setHits([]); setQ(''); setMissing('');
    router.push(`/employees/${encodeURIComponent(data.emp_code)}`);
  }

  const search = (
    <div className="search">
      <Icon name="search" size={17} />
      <input
        value={q} placeholder="Search employee by name or ID…" autoComplete="off" aria-label="Search employees"
        onChange={e => suggest(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && go()}
        onBlur={() => setTimeout(() => { setHits([]); setMissing(''); }, 150)}
      />
      {(hits.length > 0 || missing) && (
        <div className="suggest">
          {hits.map(h => (
            <div key={h.emp_code} onMouseDown={() => go(h.emp_code)}><span className="av sm">{initials(h.name)}</span><b>{h.name}</b><span className="muted">{h.emp_code}</span></div>
          ))}
          {missing && <div style={{ cursor: 'default' }} className="muted">{missing}</div>}
        </div>
      )}
    </div>
  );

  return (
    <Frame
      nav={NAV.filter(n => !n.edit || canEdit)} adminNav={isAdmin ? ADMIN_NAV : []} panelName="HR Portal" search={search}
      bell={{ count: pending, href: '/leaves', label: pending ? `${pending} leave request(s) waiting for HR` : 'No leave requests waiting' }}
      menu={<>
        <div className="mi-head"><b>{profile.full_name}</b><small>{profile.username}</small></div>
        {profile.employee_id && <Link href="/portal" className="mi-row"><Icon name="user" size={16} /> My leave &amp; payslips</Link>}
        <MenuFoot />
      </>}
    >
      {children}
    </Frame>
  );
}
