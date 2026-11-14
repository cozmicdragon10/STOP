// Privacy view: a screen-side guard for when clients are in the room. It hides balances on the roster, shows one client at a
// time (only from a search), and locks the Reports, Admin and DEV tabs from opening. It is not access control: the server
// still decides what each role can read. It is remembered per browser on this computer, so nothing about it is saved on the server.

export const PRIVACY_STORAGE_KEY = 'privacyOn';

// Tabs that stay visible in the menu but can't be opened while privacy is on
export const PRIVACY_LOCKED_TABS: readonly string[] = ['reports', 'admin', 'dev'];

export const isTabLockedByPrivacy = (tab: string, privacyOn: boolean): boolean =>
  privacyOn && PRIVACY_LOCKED_TABS.includes(tab);

export const readPrivacyOn = (): boolean => {
  try {
    return localStorage.getItem(PRIVACY_STORAGE_KEY) === 'true';
  } catch {
    return false; // storage unavailable: start with privacy off
  }
};

export const writePrivacyOn = (on: boolean): void => {
  try {
    localStorage.setItem(PRIVACY_STORAGE_KEY, String(on));
  } catch {
    // storage unavailable: the setting lasts until the page is reloaded
  }
};

// With privacy on, the roster shows nothing until a search is typed, then only the first matching client.
// `more` counts the other matches so the screen can say there are more to narrow down.
export const privacyRosterView = <T>(rows: T[], searchTerm: string): { shown: T[]; more: number } => {
  if (!searchTerm.trim()) return { shown: [], more: 0 };
  return { shown: rows.slice(0, 1), more: Math.max(0, rows.length - 1) };
};
