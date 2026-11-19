import { useState } from 'react';
import { reportTabsFor, currentReportFor } from '../../utils/reports';
import { PROGRAM_STATUSES } from '../../utils/clients';
import GroupIncomeReport from './GroupIncomeReport';
import GroupCashDepositReport from './GroupCashDepositReport';
import UserCashDepositReport from './UserCashDepositReport';
import CounselorClientReport from './CounselorClientReport';
import UserActivityReport from './UserActivityReport';
import MonthlyPoReports from './MonthlyPoReports';
import FederalSoGroupReport from './FederalSoGroupReport';
import type { Client, Group } from '../../api';


interface Props {
  user: { employeeemail: string; role: string };
  // Current clients (not discharged)
  clients: Client[];
  groups: Group[];
  onOpenClient: (client: Client) => void;
  // Opens an account by id, loading the client if it isn't in the current list (e.g. discharged)
  onOpenClientId: (clientId: number) => void;
}

// The Reports tab: a row of report tabs (filtered by role) and the picked report
export default function ReportsTab({ user, clients, groups, onOpenClient, onOpenClientId }: Props) {
  // The report tab last picked; null until one is picked (the role's first report shows)
  const [reportTab, setReportTab] = useState<string | null>(null);
  // Cash Deposits: cash taken at group sessions, or cash payments users took outside a group
  const [cashTab, setCashTab] = useState<'group' | 'user'>('group');

  const currentReport = currentReportFor(reportTab, user.role);

  const pickReport = (id: string) => {
    if (id !== currentReport) setReportTab(id);
  };

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex flex-wrap border-b border-slate-800">
        {reportTabsFor(user.role).map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={currentReport === t.id}
            onClick={() => pickReport(t.id)}
            className={`px-4 py-2.5 border-b-2 -mb-px text-sm font-medium whitespace-nowrap transition ${currentReport === t.id ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {currentReport === 'groupIncome' && <GroupIncomeReport userEmail={user.employeeemail} canRecordDeposits={user.role === 'Business Administrator'} />}

      {currentReport === 'cashDeposits' && (
        <div className="space-y-4">
          <div className="inline-flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            {([['group', 'Group Cash Deposits'], ['user', 'User Cash Deposits']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCashTab(id)}
                aria-pressed={cashTab === id}
                className={`px-4 py-1.5 rounded text-xs font-semibold transition ${cashTab === id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {cashTab === 'group'
            ? <GroupCashDepositReport userEmail={user.employeeemail} isAdmin={user.role === 'Business Administrator'} />
            : <UserCashDepositReport userEmail={user.employeeemail} isAdmin={user.role === 'Business Administrator'} />}
        </div>
      )}

      {currentReport === 'counselorClients' && <CounselorClientReport clients={clients} groups={groups} statuses={PROGRAM_STATUSES} onOpenClient={onOpenClientId} />}

      {currentReport === 'federalSo' && <FederalSoGroupReport clients={clients} groups={groups} onOpenClient={onOpenClient} />}

      {currentReport === 'poMonthly' && <MonthlyPoReports userEmail={user.employeeemail} onOpenClient={onOpenClientId} />}

      {currentReport === 'userActivity' && <UserActivityReport userEmail={user.employeeemail} onOpenClient={onOpenClientId} />}
    </div>
  );
}
