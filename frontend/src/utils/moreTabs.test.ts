import { describe, expect, it } from 'vitest';
import { isMoreTab, moreTabsFor } from './moreTabs';

describe('moreTabs', () => {
  it('puts Attendance, Assessments and Admin under More for Office Admins', () => {
    expect([...moreTabsFor('Office Admin')].sort()).toEqual(['admin', 'attendance', 'sessions']);
  });

  it('puts Polygraphs, Reports, Supervising Agents and Forms under More for Counselors', () => {
    expect([...moreTabsFor('Counselor')].sort()).toEqual(['agents', 'forms', 'polygraph', 'reports']);
  });

  it('keeps every tab on the bar for Business Administrators and Polygraphers', () => {
    expect(moreTabsFor('Business Administrator')).toEqual([]);
    expect(moreTabsFor('Polygrapher')).toEqual([]);
    expect(isMoreTab('Business Administrator', 'admin')).toBe(false);
  });

  it('never moves Home or Settings', () => {
    for (const role of ['Office Admin', 'Counselor']) {
      expect(isMoreTab(role, 'home')).toBe(false);
      expect(isMoreTab(role, 'settings')).toBe(false);
    }
  });
});
