// Tabs that sit under the tab bar's "More" menu instead of on the bar itself, so roles with many sections get a shorter bar.
// Only where they're shown changes: these roles can still open every one of them (the phone Menu and Home's Sections list
// them all). Business Administrators and DEV accounts keep every tab on the bar.
const MORE_TABS_BY_ROLE: Record<string, readonly string[]> = {
  'Office Admin': ['attendance', 'sessions', 'admin'],
  Counselor: ['polygraph', 'reports', 'agents', 'forms'],
};

export const moreTabsFor = (role: string): readonly string[] => MORE_TABS_BY_ROLE[role] ?? [];

export const isMoreTab = (role: string, tab: string): boolean => moreTabsFor(role).includes(tab);
