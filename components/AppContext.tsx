'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Profile, Settings } from '@/lib/types';

interface AppCtx {
  profile: Profile;
  settings: Settings;
  canEdit: boolean;
  isAdmin: boolean;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ profile, settings, children }: { profile: Profile; settings: Settings; children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const notify = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(t => (t?.msg === msg ? null : t)), 4000);
  }, []);
  const value = useMemo<AppCtx>(() => ({
    profile, settings, notify,
    canEdit: profile.role !== 'viewer',
    isAdmin: profile.role === 'admin',
  }), [profile, settings, notify]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`} role="status">{toast.msg}</div>}
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
