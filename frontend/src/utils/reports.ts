// Report tabs, in order. Counselors and Therapists only get the ones marked allRoles.
export const REPORT_TABS = [
  { id: 'agent', label: 'Weekly Agent Report', allRoles: false },
  { id: 'deposit', label: 'Monthly Deposit Report', allRoles: false },
  { id: 'groupIncome', label: 'Group Income Report', allRoles: false },
  { id: 'cashDeposits', label: 'Group Cash Deposits', allRoles: true },
  { id: 'counselorClients', label: 'Counselor Client Report', allRoles: false },
];
export const reportTabsFor = (role?: string) => REPORT_TABS.filter(t => t.allRoles || role === 'Business Administrator' || role === 'Office Admin');
// The picked report if the role can see it, otherwise the role's first report
export const currentReportFor = (picked: string | null, role?: string) => {
  const tabs = reportTabsFor(role);
  return tabs.some(t => t.id === picked) ? picked : tabs[0]?.id ?? null;
};
