import { useEffect, useState } from 'react';
import { useUnsavedForm } from '../../hooks/useUnsavedForm';
import { CalendarDays, CalendarX, List, Printer, SlidersHorizontal, Trash2, UserX } from 'lucide-react';
import ClientAttendanceCalendar from './ClientAttendanceCalendar';
import { printAttendanceReceipt } from '../../utils/receipt';
import { deleteAttendance, getClient, getClientAttendance, getClientCalendar, getClientFinancials, getClientGroupCancellations, getClientMissedGroups, type GroupCancellation, type MissedGroup } from '../../api';
import { groupCheckInDays, hasUpcoming, upcomingItems, type ClientCalendarData } from '../../utils/clientCalendar';
import ClientComingUp from './ClientComingUp';
import RecordFilterBar from './RecordFilterBar';
import MonthHeader from './MonthHeader';
import { EMPTY_ATTENDANCE_FILTERS, groupByMonth, sortedUnique, toggleInSet } from '../../utils/filters';
import { attendanceBalanceChange, formatMoney, signedMoney } from '../../utils/ledger';
import { formatBalance } from '../../utils/balance';
import { formatLogMonthDay, formatLogYear, localYmd } from '../../utils/dates';
import { missedGroupLabel, missedGroupSummary } from '../../utils/missedGroups';
import { paymentMethodText } from '../../utils/paymentMethods';

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
  // For printed attendance receipts
  clientName: string;
  docNumber: string;
  onError: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// The Attendance tab of a client's account: sessions by month with fee, payment, and the balance before and after.
// Business Administrators can delete a session, which takes back its fee and payment.
export default function ClientAttendanceHistory({ clientId, balance, attendance, canDelete, onDeleted, onSuccess, clientName, docNumber, onError }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- attendance rows are untyped throughout App
  const printAttendance = (att: any) => {
    const c = attendanceBalanceChange(att);
    const kind = att.type === 'Assessment' || att.type === 'Individual' ? att.type : 'Group';
    const paidOnOpen = Number(att.paidonopen || 0);
    printAttendanceReceipt({
      clientName, docNumber, sessionKind: kind,
      // Assessments and individuals come back as e.g. "Individual - Individual Session"
      sessionName: kind === 'Group' ? (att.groupname || 'Group Session') : String(att.groupname || kind).replace(new RegExp(`^${kind} - `), ''),
      sessionDate: localYmd(att.date),
      // A group's covering counselor (saved by email), or the group's usual counselor
      provider: att.provider || att.coveredby || att.groupcounselor || null,
      fee: c.fee,
      payments: [
        { label: 'Paid when the session was opened', amount: paidOnOpen, method: 'Cash', alreadyApplied: true },
        { label: paidOnOpen > 0 ? 'Paid when the session was closed' : 'Payment', amount: c.paid, method: att.paymentmethod ? paymentMethodText(att.paymentmethod, att.paymentsubtype, att.paymentreference) : null },
      ],
      // attendanceBalanceChange gives the shown sign; the receipt takes the stored one
      balanceBefore: -c.before, balanceAfter: -c.after, clientId,
      // Reprinted from the account: the balance today is printed too, so the one from that session isn't taken for it
      reprint: { currentBalance: balance, asOf: localYmd(att.date) },
    }, onError);
  };
  const [filters, setFilters] = useState(EMPTY_ATTENDANCE_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // List (by month, with fees and balances) or a month calendar
  const [view, setView] = useState<'list' | 'calendar'>('list');
  // Months (YYYY-MM) the user has collapsed
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());
  // Session being deleted, with the reason typed so far
  const [deleting, setDeleting] = useState<{ id: number; reason: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [saving, setSaving] = useState(false);
  // A reason typed for deleting an attendance
  useUnsavedForm(!!deleting?.reason.trim());

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

  // Group meetings cancelled while the client was in the group: shown among the sessions so a missing week is explained.
  // Kept with the client they were loaded for, so another client's never show while the next ones load.
  const [cancelled, setCancelled] = useState<{ clientId: number; rows: GroupCancellation[] }>({ clientId: 0, rows: [] });
  useEffect(() => {
    let current = true;
    getClientGroupCancellations(clientId)
      .then(rows => { if (current) setCancelled({ clientId, rows }); })
      // The sessions still show without them
      .catch(() => {});
    return () => { current = false; };
  }, [clientId]);
  const cancellations = cancelled.clientId === clientId ? cancelled.rows : [];

  // Group meetings the client was expected at and didn't check in to (worked out on the server). Loaded again when the
  // attendance changes, since a check-in or a deletion changes what was missed.
  const [missedLoad, setMissedLoad] = useState<{ clientId: number; rows: MissedGroup[] }>({ clientId: 0, rows: [] });
  useEffect(() => {
    let current = true;
    getClientMissedGroups(clientId)
      .then(rows => { if (current) setMissedLoad({ clientId, rows }); })
      // The sessions still show without them
      .catch(() => {});
    return () => { current = false; };
  }, [clientId, attendance]);
  const missedGroups = missedLoad.clientId === clientId ? missedLoad.rows : [];

  // What's coming up, for the Coming Up box and the calendar: the group's next meetings, booked assessments and
  // polygraphs (and polygraphs taken). Loaded again when the attendance changes.
  const [scheduleLoad, setScheduleLoad] = useState<{ clientId: number; data: ClientCalendarData } | null>(null);
  useEffect(() => {
    let current = true;
    getClientCalendar(clientId)
      .then(data => { if (current) setScheduleLoad({ clientId, data }); })
      // The attendance still shows without it
      .catch(() => {});
    return () => { current = false; };
  }, [clientId, attendance]);
  const schedule = scheduleLoad?.clientId === clientId ? scheduleLoad.data : null;
  const missedTotals = missedGroupSummary(missedGroups);

  const search = filters.search.trim().toLowerCase();
  // Rows of either kind; a cancellation's date is read as local midnight (a bare YYYY-MM-DD would be read as UTC)
  /* eslint-disable @typescript-eslint/no-explicit-any -- attendance rows are untyped throughout App */
  const rows: any[] = [
    ...attendance,
    ...cancellations.map(c => ({ ...c, cancellation: true, type: 'Group Cancelled', date: `${c.date}T00:00:00`, comments: c.reason })),
    ...missedGroups.map(m => ({ ...m, missed: true, missedLabel: missedGroupLabel(m), type: 'Missed', date: `${m.date}T00:00:00`, comments: m.callinreason })),
  ];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const shown = rows.filter(a => {
    if ((a.cancellation || a.missed) && filters.payment) return false;
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
  const shownSessions = shown.filter(a => !a.cancellation && !a.missed).length;
  const shownCancelled = shown.filter(a => a.cancellation).length;
  const shownMissed = shown.filter(a => a.missed).length;

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
            <span className="bg-blue-600 text-white rounded-full px-1.5 text-[0.625rem] leading-4">{activeFilterCount}</span>
          )}
        </button>
        <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs font-semibold" role="group" aria-label="Attendance view">
          {([['list', 'List', List], ['calendar', 'Calendar', CalendarDays]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={`px-3 py-1.5 flex items-center gap-1.5 ${view === key ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:text-white'}`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-500">
          {shownSessions === attendance.length ? `${attendance.length} sessions` : `Showing ${shownSessions} of ${attendance.length}`}
          {shownCancelled > 0 && ` · ${shownCancelled} group${shownCancelled === 1 ? '' : 's'} cancelled`}
          {shownMissed > 0 && ` · ${shownMissed === missedTotals.total ? '' : `${shownMissed} of `}${missedTotals.total} missed`}
        </span>
      </div>
      {missedTotals.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-red-500/5 border border-red-500/30 px-4 py-2.5 rounded-xl text-sm">
          <UserX size={16} className="text-red-400 shrink-0" />
          <p className="text-white font-semibold">
            Missed Groups: <span className="text-red-300">{missedTotals.total}</span>
          </p>
          <p className="text-xs text-slate-400">
            {missedTotals.noShows} no-show{missedTotals.noShows === 1 ? '' : 's'} · {missedTotals.calledIn} called in
            {missedTotals.last90 > 0 && <> · <span className="text-red-300 font-semibold">{missedTotals.last90}</span> in the last 90 days</>}
            {missedTotals.latest && <> · last missed {formatLogMonthDay(`${missedTotals.latest}T00:00:00`)}, {formatLogYear(`${missedTotals.latest}T00:00:00`)}</>}
          </p>
          <button
            type="button"
            onClick={() => setFilters(f => ({ ...f, type: f.type === 'Missed' ? '' : 'Missed' }))}
            aria-pressed={filters.type === 'Missed'}
            className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold border ${filters.type === 'Missed' ? 'bg-red-600 border-red-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
          >
            {filters.type === 'Missed' ? 'Show All' : 'Show Only Missed'}
          </button>
        </div>
      )}
      {showFilters && (
        <RecordFilterBar
          search={filters.search}
          onSearch={v => setFilters(f => ({ ...f, search: v }))}
          searchPlaceholder="Group, type, or comments..."
          selects={[
            { label: 'Group', value: filters.group, onChange: v => setFilters(f => ({ ...f, group: v })), allLabel: 'All Groups', options: sortedUnique(rows.map(a => a.groupname || 'Group Session')) },
            { label: 'Type', value: filters.type, onChange: v => setFilters(f => ({ ...f, type: v })), allLabel: 'All Types', options: sortedUnique(rows.map(a => a.type)) },
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
          total={rows.length}
          onClear={() => setFilters(f => ({ ...EMPTY_ATTENDANCE_FILTERS, sort: f.sort }))}
        />
      )}
      {shown.length === 0 && rows.length > 0 && (
        <p className="text-center text-slate-500 text-sm py-4">No attendance matches these filters.</p>
      )}
      {/* Left off for clients with no group and nothing booked (discharged ones, say) */}
      {view === 'list' && schedule && (schedule.group || hasUpcoming(schedule)) && (
        <ClientComingUp
          items={upcomingItems(schedule, groupCheckInDays(attendance))}
          today={schedule.today}
          phase={schedule.phase}
          inGroup={!!schedule.group}
          onOpenCalendar={() => setView('calendar')}
        />
      )}
      {view === 'calendar' && <ClientAttendanceCalendar key={clientId} rows={shown} schedule={schedule} filtered={activeFilterCount > 0} />}
      {view === 'list' && groupByMonth(shown, filters.sort).map(month => {
        const sessions = month.rows.filter(att => !att.cancellation && !att.missed);
        const totals = sessions.reduce((t, att) => {
          const c = attendanceBalanceChange(att);
          return { fee: t.fee + c.fee, paid: t.paid + c.paid, change: t.change + (c.after - c.before) };
        }, { fee: 0, paid: 0, change: 0 });
        const monthChange = Math.round(totals.change * 100) / 100;
        const monthMissed = month.rows.filter(att => att.missed).length;
        const collapsed = collapsedMonths.has(month.key);
        return (
          <div key={month.key} className="space-y-2">
            <MonthHeader label={month.label} count={sessions.length} noun="session" collapsed={collapsed} onToggle={() => setCollapsedMonths(prev => toggleInSet(prev, month.key))}>
              {monthMissed > 0 && <span className="text-red-400 font-semibold">{monthMissed} missed</span>}
              {sessions.length > 0 && <>
              <span className="text-slate-500">Fees <span className="text-red-400 font-semibold">{signedMoney(totals.fee)}</span></span>
              <span className="text-slate-500">Paid <span className="text-emerald-400 font-semibold">{signedMoney(totals.paid)}</span></span>
              <span className="text-slate-500">Change <span className={`font-semibold ${monthChange > 0 ? 'text-emerald-400' : monthChange < 0 ? 'text-red-400' : 'text-slate-400'}`}>{monthChange > 0 ? '+' : ''}{signedMoney(monthChange)}</span></span>
              </>}
            </MonthHeader>
            {!collapsed && month.rows.map(att => {
              // A missed group meeting: expected and not checked in (no fee, payment or balance)
              if (att.missed) return (
                <div key={`missed-${att.groupid}-${localYmd(att.date)}`} className="bg-red-500/5 border border-red-500/30 px-4 py-2.5 rounded-xl text-sm">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="shrink-0 w-16 border-r border-slate-800 pr-4">
                      <p className="font-bold text-white leading-tight">{formatLogMonthDay(att.date)}</p>
                      <p className="text-[0.6875rem] text-slate-500">{formatLogYear(att.date)}</p>
                    </div>
                    <div className="flex-1 min-w-[10rem]">
                      <p className="font-semibold text-white truncate">
                        {att.groupname}
                        {att.groupschedule && <span className="ml-2 text-xs font-normal text-slate-400">{att.groupschedule}</span>}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {att.missedLabel}{att.calledin ? ` · Called in${att.callinreason ? `: ${att.callinreason}` : ''}` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1.5 border px-2 py-1 rounded-lg text-xs font-semibold ${att.calledin ? 'bg-orange-500/15 text-orange-300 border-orange-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}`}>
                      <UserX size={13} /> {att.calledin ? 'Missed (Called In)' : 'Missed'}
                    </span>
                  </div>
                </div>
              );
              // A cancelled group meeting: why there's no check-in that week (no fee, payment or balance)
              if (att.cancellation) return (
                <div key={`cancel-${att.changeid}`} className="bg-amber-500/5 border border-amber-500/30 px-4 py-2.5 rounded-xl text-sm">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="shrink-0 w-16 border-r border-slate-800 pr-4">
                      <p className="font-bold text-white leading-tight">{formatLogMonthDay(att.date)}</p>
                      <p className="text-[0.6875rem] text-slate-500">{formatLogYear(att.date)}</p>
                    </div>
                    <div className="flex-1 min-w-[10rem]">
                      <p className="font-semibold text-white truncate">
                        {att.groupname}
                        {att.groupschedule && <span className="ml-2 text-xs font-normal text-slate-400">{att.groupschedule}</span>}
                      </p>
                      <p className="text-xs text-slate-400 truncate" title={att.reason || undefined}>
                        No meeting this week{att.reason ? `: ${att.reason}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1.5 bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-1 rounded-lg text-xs font-semibold">
                      <CalendarX size={13} /> Group Cancelled
                    </span>
                  </div>
                </div>
              );
              // One compact row per session: date, group, then fee, paid, and the balance before → after
              const c = attendanceBalanceChange(att);
              const change = Math.round((c.after - c.before) * 100) / 100;
              const isDeleting = deleting?.id === att.attendanceid;
              return (
                <div key={att.attendanceid} className={`bg-slate-950 border px-4 py-2.5 rounded-xl text-sm ${isDeleting ? 'border-red-500/40' : 'border-slate-800'}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="shrink-0 w-16 border-r border-slate-800 pr-4">
                    <p className="font-bold text-white leading-tight">{formatLogMonthDay(att.date)}</p>
                    <p className="text-[0.6875rem] text-slate-500">{formatLogYear(att.date)}</p>
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
                      <p className="text-slate-500 uppercase tracking-wide text-[0.625rem] font-semibold">Fee</p>
                      <p className="text-red-400 font-semibold">{signedMoney(c.fee)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 uppercase tracking-wide text-[0.625rem] font-semibold">Paid</p>
                      <p className="text-emerald-400 font-semibold">{signedMoney(c.paid)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 uppercase tracking-wide text-[0.625rem] font-semibold">Change</p>
                      <p className={`font-semibold ${change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-slate-400'}`}>{change > 0 ? '+' : ''}{signedMoney(change)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 uppercase tracking-wide text-[0.625rem] font-semibold">Balance</p>
                      <p className="whitespace-nowrap">
                        <span className="text-slate-400">{signedMoney(c.before)} → </span>
                        <span className={`font-semibold ${c.after < 0 ? 'text-red-400' : 'text-white'}`}>{signedMoney(c.after)}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => printAttendance(att)}
                    title="Print a receipt for this attendance"
                    aria-label="Print a receipt for this attendance"
                    className="shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white p-1.5 rounded"
                  >
                    <Printer size={13} />
                  </button>
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
