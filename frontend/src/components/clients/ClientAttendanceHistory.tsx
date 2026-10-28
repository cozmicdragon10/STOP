import { useState } from 'react';
import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { deleteAttendance, getClient, getClientAttendance, getClientFinancials } from '../../api';
import RecordFilterBar from './RecordFilterBar';
import MonthHeader from './MonthHeader';
import { EMPTY_ATTENDANCE_FILTERS, groupByMonth, sortedUnique, toggleInSet } from '../../utils/filters';
import { attendanceBalanceChange, formatMoney, signedMoney } from '../../utils/ledger';
import { formatBalance } from '../../utils/balance';
import { formatLogMonthDay, formatLogYear, localYmd } from '../../utils/dates';

/* eslint-disable @typescript-eslint/no-explicit-any -- attendance and ledger rows are untyped throughout App */
export interface AttendanceDeleted {
  // The client the attendance was deleted from (another client may be open by the time it finishes)
  clientId: number;
  // The client's record as it is after the deletion
  changes: Record<string, unknown>;
  attendance: any[];
  financials: any[];
}

interface Props {
  clientId: number;
  // The client's current balance (stored sign: positive = owes), for the delete preview
  balance: number;
  // The client's attendance, loaded by App with the rest of the account
  attendance: any[];
  // Business Administrators can delete attendance
  canDelete: boolean;
  onDeleted: (refresh: AttendanceDeleted) => void;
  onSuccess: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// The Attendance tab of a client's account: sessions by month with fee, payment, and the balance before and after.
// Business Administrators can delete a session, which takes back its fee and payment.
export default function ClientAttendanceHistory({ clientId, balance, attendance, canDelete, onDeleted, onSuccess }: Props) {
  const [filters, setFilters] = useState(EMPTY_ATTENDANCE_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // Months (YYYY-MM) the user has collapsed
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());
  // Session being deleted, with the reason typed so far
  const [deleting, setDeleting] = useState<{ id: number; reason: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    const reason = deleting?.reason.trim();
    if (!deleting || !reason) return;
    setSaving(true);
    setDeleteError('');
    try {
      const res = await deleteAttendance(deleting.id, reason);
      setDeleting(null);
      const voucherText = res.voucher ? {
        removed: ' The poly fee voucher it earned was removed.',
        kept: ' The poly fee voucher it earned was kept because the client attended again later that month.',
        used: ' The poly fee voucher it earned was already used, so none was removed.',
      }[res.voucher] : '';
      const feeMovedText = res.feeMoved ? ` The ${formatMoney(res.feeMoved.amount)} treatment fee moved to ${res.feeMoved.to}.` : '';
      onSuccess(`Attendance deleted. Updated Balance: ${formatBalance(res.newBalance)}.${feeMovedText}${voucherText} The closed group and the Group Income Report were updated too.`);
      // The whole client record is loaded again: besides the balance, BIP week, vouchers, and last attended, the deletion
      // can change what check-in works out from it, like whether the monthly treatment fee was already charged
      const [fresh, financials, client] = await Promise.all([getClientAttendance(clientId), getClientFinancials(clientId), getClient(clientId)]);
      onDeleted({ clientId, changes: client as unknown as Record<string, unknown>, attendance: fresh, financials });
    } catch (err) {
      setDeleteError(err instanceof Error && err.message ? err.message : 'Could not delete the attendance.');
    } finally {
      setSaving(false);
    }
  };

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
              const isDeleting = deleting?.id === att.attendanceid;
              return (
                <div key={att.attendanceid} className={`bg-slate-950 border px-4 py-2.5 rounded-xl text-sm ${isDeleting ? 'border-red-500/40' : 'border-slate-800'}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => { setDeleting(isDeleting ? null : { id: att.attendanceid, reason: '' }); setDeleteError(''); }}
                      title="Delete this attendance"
                      aria-label="Delete this attendance"
                      className="shrink-0 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 p-1.5 rounded"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                {isDeleting && deleting && (() => {
                  // Deleting takes back the fee and what was kept of the payment
                  const newBalance = balance - Number(att.groupfee || 0) + Number(att.accountpaid || 0);
                  const removed = [
                    Number(att.groupfee || 0) > 0 ? `the ${formatMoney(Number(att.groupfee))} fee` : '',
                    Number(att.accountpaid || 0) > 0 ? `the ${formatMoney(Number(att.accountpaid))} payment` : '',
                  ].filter(Boolean).join(' and ');
                  return (
                    <form onSubmit={handleDelete} className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                      <p className="text-xs font-semibold text-red-300">Delete this attendance</p>
                      <input
                        type="text"
                        value={deleting.reason}
                        onChange={(e) => setDeleting({ ...deleting, reason: e.target.value })}
                        placeholder="Reason…"
                        autoFocus
                        required
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm"
                      />
                      <p className="text-xs text-slate-400">
                        {removed
                          ? <>Removes {removed} from the ledger. Balance {formatBalance(balance)} → {formatBalance(newBalance)}; later ledger and attendance balances move by the same amount.</>
                          : 'No fee or payment was recorded, so the balance does not change.'}
                        {/* Attendance rows keep the column's quoted name, "Group" */}
                        {att.Group ? ' The closed group and the Group Income Report are updated too.' : ''}
                        {att.Group && Number(att.groupfee || 0) > 0 ? ' If it paid the treatment fee for the month (or the quarter / 6 months for Phase 3 and 4) and an uncharged group check-in in that period is left, the fee moves to the earliest one.' : ''}
                        {att.polyvoucherawarded ? ' The poly fee voucher it earned is removed unless the client attended again later that month.' : ''}
                        {' Last Date Attended becomes the most recent Group, Individual, or Assessment check-in left.'}
                      </p>
                      {deleteError && <p className="text-xs text-red-400">{deleteError}</p>}
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => { setDeleting(null); setDeleteError(''); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Cancel</button>
                        <button
                          type="submit"
                          disabled={saving || !deleting.reason.trim()}
                          className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                        >
                          Delete Attendance
                        </button>
                      </div>
                    </form>
                  );
                })()}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
