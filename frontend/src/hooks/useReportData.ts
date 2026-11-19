import { useEffect, useState } from 'react';
import { errorMessage } from '../utils/errors';

// Loads a report for a key (a date range "from|to", or any fixed string). load must be a function defined outside the
// component, so it stays the same between renders. The last result stays on screen while the next one loads.
export function useReportData<T>(key: string | null, load: (key: string) => Promise<T>, fallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; error: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    load(key)
      .then(d => { if (!cancelled) { setData(d); setLoaded({ key, error: '' }); } })
      .catch(err => { if (!cancelled) setLoaded({ key, error: errorMessage(err, fallback) }); });
    return () => { cancelled = true; };
  }, [key, load, fallback]);
  const status: 'loading' | 'error' | 'ready' = !loaded || (key && loaded.key !== key) ? 'loading' : loaded.error ? 'error' : 'ready';
  return { data, status, error: loaded?.error ?? '', loadedKey: loaded?.key ?? null };
}
