'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// ---- app-wide "something is loading" counter (drives the progress bar at the top of the page)
let busy = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
export function trackBusy<T>(p: Promise<T>): Promise<T> {
  busy++; emit();
  return p.finally(() => { busy = Math.max(0, busy - 1); emit(); });
}
export function useGlobalBusy(): boolean {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => busy > 0,
    () => false,
  );
}

/** Runs an async loader whenever `deps` change (or `reload()` is called). Keeps old data on screen while reloading. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: undefined }));
    trackBusy(loaderRef.current())
      .then(data => alive && setState({ data, loading: false }))
      .catch(e => alive && setState(s => ({ ...s, loading: false, error: friendlyError(e) })));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload: () => setTick(t => t + 1) };
}

/** Turns network / database errors into something a person can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Could not reach the server. Check your internet connection and try again.';
  if (/JWT|not logged in|401/i.test(msg)) return 'Your session has expired. Please log in again.';
  if (/does not exist|column .* not found|schema cache/i.test(msg)) return `The database is missing something this page needs — run supabase/schema.sql in Supabase. (${msg})`;
  return msg;
}
