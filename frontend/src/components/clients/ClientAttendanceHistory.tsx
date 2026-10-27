import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import RecordFilterBar from './RecordFilterBar';
import MonthHeader from './MonthHeader';
import { EMPTY_ATTENDANCE_FILTERS, groupByMonth, sortedUnique, toggleInSet } from '../../utils/filters';
import { attendanceBalanceChange, signedMoney } from '../../utils/ledger';
import { formatLogMonthDay, formatLogYear, localYmd } from '../../utils/dates';

interface Props {
  // The client's attendance, loaded by App with the rest of the account
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- attendance rows are untyped throughout App
  attendance: any[];
}

// The Attendance tab of a client's account: sessions by month with fee, payment, and the balance before and after
export default function ClientAttendanceHistory({ attendance }: Props) {
  const [filters, setFilters] = useState(EMPTY_ATTENDANCE_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // Months (YYYY-MM) the user has collapsed
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());

  const search = filters.search.trim().toLowerCase();
  const shown = attendance.filter(a => {
    const day = localYmd(a.date);
    const paid = Number(a.accountpaid || 0) > 0;
    if (filters.group && (a.groupname || 'Group Session') !== filters.group) return false;
    if (filters.type && a.type !== filters.type) return false;
    if (filters.payment === 'Paid' && !paid) return false;
    if (filters.payment === 'No Payment' && paid) return false;
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    if (search && ![a.groupname, a.groupschedule, a.type, a.comments, a.paymentmethod].some(v => String(v ?? '').toLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    return filters.sort === 'oldest' ? diff : -diff;
  });
  // Filters set but hidden are counted on the button so they aren't forgotten
  const activeFilterCount = [filters.search.trim(), filters.group, filters.type, filters.payment, filters.from, filters.to].filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowFilters(show => !show)}
          aria-expanded={showFilters}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
        >
          <SlidersHorizontal size={13} /> Filters
          {activeFilterCount > 0 && (
            <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{activeFilterCount}</span>
          )}
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {shown.length === attendance.length ? `${attendance.length} sessions` : `Showing ${shown.length} of ${attendance.length}`}
        </span>
      </div>
      {showFilters && (
        <RecordFilterBar
          search={filters.search}
          onSearch={v => setFilters(f => ({ ...f, search: v }))}
          searchPlaceholder="Group, type, or comments..."
          selects={[
            { label: 'Group', value: filters.group, onChange: v => setFilters(f => ({ ...f, group: v })), allLabel: 'All Groups', options: sortedUnique(attendance.map(a => a.groupname || 'Group Session')) },
            { label: 'Type', value: filters.type, onChange: v => setFilters(f => ({ ...f, type: v })), allLabel: 'All Types', options: sortedUnique(attendance.map(a => a.type)) },
            { label: 'Payment', value: filters.payment, onChange: v => setFilters(f => ({ ...f, payment: v })), allLabel: 'All', options: ['Paid', 'No Payment'] },
          ]}
          from={filters.from}
          to={filters.to}
          onFrom={v => setFilters(f => ({ ...f, from: v }))}
          onTo={v => setFilters(f => ({ ...f, to: v }))}
          sort={filters.sort}
          onSort={v => setFilters(f => ({ ...f, sort: v }))}
          sortOptions={[
            { value: 'newest', label: 'Newest First' },
            { value: 'oldest', label: 'Oldest First' },
          ]}
          shown={shown.length}
          total={attendance.length}
          onClear={() => setFilters(f => ({ ...EMPTY_ATTENDANCE_FILTERS, sort: f.sort }))}
        />
      )}
      {shown.length === 0 && attendance.length > 0 && (
        <p className="text-center text-slate-500 text-sm py-4">No attendance matches these filters.</p>
      )}
      {groupByMonth(shown, filters.sort).map(month => {
        const totals = month.rows.reduce((t, att) => {
          const c = attendanceBalanceChange(att);
          return { fee: t.fee + c.fee, paid: t.paid + c.paid, change: t.change + (c.after - c.before) };
        }, { fee: 0, paid: 0, change: 0 });
        const monthChange = Math.round(totals.change * 100) / 100;
        const collapsed = collapsedMonths.has(month.key);
        return (
          <div key={month.key} className="space-y-2">
            <MonthHeader label={month.label} count={month.rows.length} noun="session" collapsed={collapsed} onToggle={() => setCollapsedMonths(prev => toggleInSet(prev, month.key))}>
              <span className="text-slate-500">Fees <span className="text-red-400 font-semibold">{signedMoney(totals.fee)}</span></span>
              <span className="text-slate-500">Paid <span className="text-emerald-400 font-semibold">{signedMoney(totals.paid)}</span></span>
              <span className="text-slate-500">Change <span className={`font-semibold ${monthChange > 0 ? 'text-emerald-400' : monthChange < 0 ? 'text-red-400' : 'text-slate-400'}`}>{monthChange > 0 ? '+' : ''}{signedMoney(monthChange)}</span></span>
            </MonthHeader>
            {!collapsed && month.rows.map(att => {
              // One compact row per session: date, group, then fee, paid, and the balance before → after
              const c = attendanceBalanceChange(att);
              const change = Math.round((c.after - c.before) * 100) / 100;
              return (
                <div key={att.attendanceid} className="bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="shrink-0 w-16 border-r border-slate-800 pr-4">
                    <p className="font-bold text-white leading-tight">{formatLogMonthDay(att.date)}</p>
                    <p className="text-[11px] text-slate-500">{formatLogYear(att.date)}</p>
                  </div>
                  <div className="flex-1 min-w-[10rem]">
                    <p className="font-semibold text-white truncate">
                      {att.groupname || 'Group Session'}
                      {att.groupschedule && <span className="ml-2 text-xs font-normal text-slate-400">{att.groupschedule}</span>}
                    </p>
                    {att.comments && <p className="text-xs text-slate-400 truncate" title={att.comments}>{att.comments}</p>}
                  </div>
                  <div className="shrink-0 flex gap-5 text-xs text-right">
                    <div>
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Fee</p>
                      <p className="text-red-400 font-semibold">{signedMoney(c.fee)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Paid</p>
                      <p className="text-emerald-400 font-semibold">{signedMoney(c.paid)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Change</p>
                      <p className={`font-semibold ${change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-slate-400'}`}>{change > 0 ? '+' : ''}{signedMoney(change)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Balance</p>
                      <p className="whitespace-nowrap">
                        <span className="text-slate-400">{signedMoney(c.before)} → </span>
                        <span className={`font-semibold ${c.after < 0 ? 'text-red-400' : 'text-white'}`}>{signedMoney(c.after)}</span>
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
