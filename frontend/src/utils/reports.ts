// Report tabs, in order, and who sees each: 'all' (every role), 'admins' (Business Administrators and Office Admins),
// or 'business' (Business Administrators only). The server checks the business-only reports too.
type ReportAccess = 'all' | 'admins' | 'business';
export const REPORT_TABS: { id: string; label: string; access: ReportAccess }[] = [
  { id: 'agent', label: 'Weekly Agent Report', access: 'business' },
  { id: 'deposit', label: 'Monthly Deposit Report', access: 'business' },
  { id: 'groupIncome', label: 'Group Income Report', access: 'business' },
  { id: 'cashDeposits', label: 'Cash Deposits', access: 'all' },
  { id: 'counselorClients', label: 'Counselor Client Report', access: 'admins' },
  { id: 'userActivity', label: 'User Activity', access: 'admins' },
];
export const reportTabsFor = (role?: string) => REPORT_TABS.filter(t =>
  t.access === 'all'
  || role === 'Business Administrator'
  || (t.access === 'admins' && role === 'Office Admin'));
// The picked report if the role can see it, otherwise the role's first report
export const currentReportFor = (picked: string | null, role?: string) => {
  const tabs = reportTabsFor(role);
  return tabs.some(t => t.id === picked) ? picked : tabs[0]?.id ?? null;
};
