import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { getAgentReport, getDepositReport } from '../../api';
import { reportTabsFor, currentReportFor } from '../../utils/reports';
import { PROGRAM_STATUSES } from '../../utils/clients';
import { formatBalance } from '../../utils/balance';
import GroupIncomeReport from './GroupIncomeReport';
import GroupCashDepositReport from './GroupCashDepositReport';
import CounselorClientReport from './CounselorClientReport';

type CounselorReportProps = ComponentProps<typeof CounselorClientReport>;

interface Props {
  user: { employeeemail: string; role: string };
  clients: CounselorReportProps['clients'];
  groups: CounselorReportProps['groups'];
  onOpenClient: CounselorReportProps['onOpenClient'];
}

interface AgentReportRow {
  clientid: number;
  firstname: string;
  lastname: string;
  supervisingagent: string | null;
  totalattended: number | string;
  lastpolydate: string | null;
  accountbalance: number | string | null;
}

interface DepositReport {
  totalRevenue: number;
  totalCharges: number;
}

// The Reports tab: a row of report tabs (filtered by role) and the picked report
export default function ReportsTab({ user, clients, groups, onOpenClient }: Props) {
  // The report tab last picked; null until one is picked (the role's first report shows)
  const [reportTab, setReportTab] = useState<string | null>(null);
  const [agentReportData, setAgentReportData] = useState<AgentReportRow[] | null>(null);
  const [depositReportData, setDepositReportData] = useState<DepositReport | null>(null);
  const [reportsError, setReportsError] = useState('');

  const currentReport = currentReportFor(reportTab, user.role);

  // Switching reports clears the last one's results and error, so the new one shows Loading until it arrives
  const pickReport = (id: string) => {
    if (id === currentReport) return;
    setReportsError('');
    setAgentReportData(null);
    setDepositReportData(null);
    setReportTab(id);
  };

  // The agent and deposit reports are fetched fresh each time their tab is shown
  useEffect(() => {
    if (currentReport !== 'agent' && currentReport !== 'deposit') return;
    let cancelled = false;
    if (currentReport === 'agent') {
      getAgentReport()
        .then(data => {
          if (cancelled) return;
          if (!Array.isArray(data)) throw new Error();
          setAgentReportData(data);
        })
        .catch(() => { if (!cancelled) setReportsError('Failed to load the weekly agent report.'); });
    } else {
      getDepositReport()
        .then(data => {
          if (cancelled) return;
          if (typeof data?.totalRevenue !== 'number' || typeof data?.totalCharges !== 'number') throw new Error();
          setDepositReportData(data);
        })
        .catch(() => { if (!cancelled) setReportsError('Failed to load the monthly deposit report.'); });
    }
    return () => { cancelled = true; };
  }, [currentReport]);

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

      {reportsError && <p className="text-xs text-red-400">{reportsError}</p>}

      {currentReport === 'groupIncome' && <GroupIncomeReport userEmail={user.employeeemail} canRecordDeposits={user.role === 'Business Administrator'} />}

      {currentReport === 'cashDeposits' && <GroupCashDepositReport userEmail={user.employeeemail} isAdmin={user.role === 'Business Administrator'} />}

      {currentReport === 'counselorClients' && <CounselorClientReport clients={clients} groups={groups} statuses={PROGRAM_STATUSES} onOpenClient={onOpenClient} />}

      {currentReport === 'agent' && !reportsError && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
          <h3 className="font-semibold text-white mb-4">Weekly Supervising Agent Summary</h3>
          <table className="w-full text-left border-collapse text-xs">
            <thead><tr className="bg-slate-800/50 text-slate-400 uppercase"><th className="p-3">Client</th><th className="p-3">Agent</th><th className="p-3">Attended Sessions</th><th className="p-3">Last Poly</th><th className="p-3">Balance</th></tr></thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {agentReportData?.map(r => (
                <tr key={r.clientid}><td className="p-3 font-medium text-white">{r.lastname}, {r.firstname}</td><td className="p-3 text-slate-300">{r.supervisingagent}</td><td className="p-3">{r.totalattended}</td><td className="p-3 text-slate-400">{r.lastpolydate ? new Date(r.lastpolydate).toLocaleDateString() : 'None'}</td><td className="p-3 font-semibold text-slate-200">{formatBalance(r.accountbalance)}</td></tr>
              ))}
              {(!agentReportData || agentReportData.length === 0) && (
                <tr><td colSpan={5} className="p-6 text-center text-slate-500 text-sm">{agentReportData ? 'No clients to report.' : 'Loading…'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {currentReport === 'deposit' && !depositReportData && !reportsError && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl text-center text-slate-500 text-sm">Loading…</div>
      )}

      {currentReport === 'deposit' && depositReportData && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
          <h3 className="font-semibold text-white">Monthly Deposit Summary</h3>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800"><p className="text-xs text-slate-400">Total Revenue Collected</p><p className="text-2xl font-bold text-emerald-400">${depositReportData.totalRevenue.toFixed(2)}</p></div>
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800"><p className="text-xs text-slate-400">Total Charges Assessed</p><p className="text-2xl font-bold text-amber-400">${depositReportData.totalCharges.toFixed(2)}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
