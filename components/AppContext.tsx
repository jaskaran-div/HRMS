'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { Profile, Settings } from '@/lib/types';
import type { OrgSummary } from '@/lib/org';
import type { Feature } from '@/lib/billing/catalog';
import { canEditRole, canManageBilling, canManageUsers, isAdminRole } from '@/lib/roles';

type Kind = 'ok' | 'err' | 'info';

interface AppCtx {
  profile: Profile;
  settings: Settings;
  org: OrgSummary;
  canEdit: boolean;
  isAdmin: boolean;
  /** may invite / manage logins (owner, admin, HR admin) */
  canManageUsers: boolean;
  /** owner: subscription, add-ons, ownership */
  isOwner: boolean;
  /** the organization's plan includes this feature */
  has: (f: Feature) => boolean;
  /** SMTP is configured on the server, so emails can be sent. */
  mailReady: boolean;
  /** Google Drive document storage is configured on the server. */
  driveReady: boolean;
  /** Shows a message in the corner: 'ok' = success (default), 'err' = error, 'info' = neutral. */
  notify: (msg: string, kind?: Kind) => void;
}

const Ctx = createContext<AppCtx | null>(null);
const TITLE: Record<Kind, string> = { ok: 'Done', err: 'Something went wrong', info: 'Note' };
const ICON: Record<Kind, string> = { ok: 'checkCircle', err: 'alert', info: 'info' };

export function AppProvider({ profile, settings, org, mailReady = false, driveReady = false, children }: {
  profile: Profile; settings: Settings; org: OrgSummary; mailReady?: boolean; driveReady?: boolean; children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: Kind }[]>([]);
  const next = useRef(1);
  const close = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);
  const notify = useCallback((msg: string, kind: Kind = 'ok') => {
    const id = next.current++;
    setToasts(t => [...t.filter(x => x.msg !== msg), { id, msg, kind }].slice(-4));
    // errors stay longer so there is time to read them
    setTimeout(() => close(id), kind === 'err' ? 9000 : 4500);
  }, [close]);
  const value = useMemo<AppCtx>(() => ({
    profile, settings, org, notify, mailReady, driveReady,
    canEdit: canEditRole(profile.role),
    isAdmin: isAdminRole(profile.role),
    canManageUsers: canManageUsers(profile.role),
    isOwner: canManageBilling(profile.role),
    has: (f: Feature) => org.features.includes(f),
  }), [profile, settings, org, notify, mailReady, driveReady]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'err' ? 'alert' : 'status'}>
            <Icon name={ICON[t.kind]} size={20} />
            <div className="toast-body"><b>{TITLE[t.kind]}</b><span>{t.msg}</span></div>
            <button className="toast-x" onClick={() => close(t.id)} aria-label="Dismiss"><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
