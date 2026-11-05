import { createContext, useContext, useEffect } from 'react';

// App's counter of forms in the open client account with work in progress; +1 when one starts, -1 when it stops
export const UnsavedFormsContext = createContext<((change: 1 | -1) => void) | null>(null);

// Marks a form as holding unsaved work, so leaving the client account asks first
export function useUnsavedForm(dirty: boolean) {
  const report = useContext(UnsavedFormsContext);
  useEffect(() => {
    if (!dirty || !report) return;
    report(1);
    return () => report(-1);
  }, [dirty, report]);
}
