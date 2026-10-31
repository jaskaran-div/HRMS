'use client';

import { useEffect, useRef, useState } from 'react';

/** Runs an async loader whenever `deps` change (or `reload()` is called). Keeps old data on screen while reloading. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: undefined }));
    loaderRef.current()
      .then(data => alive && setState({ data, loading: false }))
      .catch(e => alive && setState(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) })));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload: () => setTick(t => t + 1) };
}
