import { describe, expect, it } from 'vitest';
import { isTabLockedByPrivacy, privacyRosterView } from './privacy';

describe('privacy view tab locks', () => {
  it('locks Reports, Admin and DEV only while privacy is on', () => {
    for (const tab of ['reports', 'admin', 'dev']) {
      expect(isTabLockedByPrivacy(tab, true)).toBe(true);
      expect(isTabLockedByPrivacy(tab, false)).toBe(false);
    }
  });

  it('leaves the other tabs open with privacy on', () => {
    for (const tab of ['home', 'clients', 'attendance', 'polygraph', 'settings']) {
      expect(isTabLockedByPrivacy(tab, true)).toBe(false);
    }
  });
});

describe('privacy view roster', () => {
  const rows = ['Adams', 'Baker', 'Carter'];

  it('shows no clients until something is searched', () => {
    expect(privacyRosterView(rows, '')).toEqual({ shown: [], more: 0 });
    expect(privacyRosterView(rows, '   ')).toEqual({ shown: [], more: 0 });
  });

  it('shows only one client, and counts the other matches', () => {
    expect(privacyRosterView(rows, 'a')).toEqual({ shown: ['Adams'], more: 2 });
  });

  it('shows the one match with nothing more to narrow down', () => {
    expect(privacyRosterView(['Baker'], 'bak')).toEqual({ shown: ['Baker'], more: 0 });
  });

  it('shows nothing when no client matches', () => {
    expect(privacyRosterView([], 'zzz')).toEqual({ shown: [], more: 0 });
  });
});
