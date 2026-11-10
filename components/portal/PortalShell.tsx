'use client';

import Link from 'next/link';
import { Frame, MenuFoot, type NavItem } from '../Shell';
import { Icon } from '../Icon';
import { useApp } from '../AppContext';

const NAV: NavItem[] = [
  { href: '/portal', icon: 'home', label: 'Overview', sub: '' },
  { href: '/portal/leave', icon: 'plane', label: 'Leave', sub: 'Apply for leave and see where your requests are.' },
  { href: '/portal/payslips', icon: 'receipt', label: 'Payslips', sub: 'Your payslips — view or download.' },
  { href: '/portal/attendance', icon: 'calendar', label: 'Attendance', sub: 'Your attendance, month by month.' },
  { href: '/portal/documents', icon: 'folder', label: 'Documents', sub: 'Your documents and company policies.' },
];
const LEAD_NAV: NavItem[] = [
  { href: '/portal/team', icon: 'users', label: 'My team', sub: 'Everyone who reports to you.' },
  { href: '/portal/approvals', icon: 'approve', label: 'Leave approvals', sub: 'Approve or decline your team’s leave.' },
];

export function PortalShell({ isLead, isStaff, pending, children }: { isLead: boolean; isStaff: boolean; pending: number; name: string; children: React.ReactNode }) {
  const { profile } = useApp();
  return (
    <Frame
      nav={isLead ? [...NAV, ...LEAD_NAV] : NAV} panelName={isLead ? 'Team leader panel' : 'Employee panel'}
      bell={isLead ? { count: pending, href: '/portal/approvals', label: pending ? `${pending} leave request(s) waiting for you` : 'No leave requests waiting' } : null}
      menu={<>
        <div className="mi-head"><b>{profile.full_name}</b><small>{profile.username}</small></div>
        {isStaff && <Link href="/" className="mi-row"><Icon name="back" size={16} /> Back to HR portal</Link>}
        <MenuFoot />
      </>}
    >
      {children}
    </Frame>
  );
}
