import { useCallback, useEffect, useRef, useState } from 'react';
import type { createRecentDocuments, RecentDocument } from './recent-documents';

export function useRecentDocuments(history: ReturnType<typeof createRecentDocuments>, onError: (error: string) => void) {
  const [entries, setEntries] = useState<RecentDocument[]>([]);
  const mounted = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const items = await history.list();
      if (mounted.current && request === revision.current) setEntries(items);
    } catch (error) {
      if (mounted.current && request === revision.current) onError(error instanceof Error ? error.message : String(error));
    }
  }, [history, onError]);

  useEffect(() => {
    mounted.current = true;
    const dispose = history.subscribe(() => { void refresh(); });
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    void refresh();
    return () => {
      mounted.current = false;
      dispose();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [history, refresh]);
  return { entries, refresh };
}
