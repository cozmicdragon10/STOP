import { useState } from 'react';
import { AlertCircle, Pencil, SlidersHorizontal, X } from 'lucide-react';
import { adjustCashPayment, fetchPolyFeeOverride, getClientAttendance, getClientFinancials, recordCardPaymentAction } from '../../api';
import type { CardPaymentAction, PaymentChangeResult, PolyFeeOverride } from '../../api';
import RecordFilterBar from './RecordFilterBar';
import MonthHeader from './MonthHeader';
import { EMPTY_LEDGER_FILTERS, groupByMonth, sortedUnique, toggleInSet } from '../../utils/filters';
import { LEDGER_TONES, PAYMENT_REVERSAL_TYPES, cardPaymentStatus, formatMoney, ledgerBalanceChange, signedMoney } from '../../utils/ledger';
import { formatBalance } from '../../utils/balance';
import { formatDisplayTime, localYmd } from '../../utils/dates';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import { polyVoucherMax, slotSummary } from '../../utils/polygraph';

/* eslint-disable @typescript-eslint/no-explicit-any -- client, ledger, and slot rows are untyped throughout App */
export interface LedgerRefresh {
  // The client the change was made on (another client may be open by the time it finishes)
  clientId: number;
  // Balance and poly fee figures the change moved, for the client record
  changes: Record<string, unknown>;
  // Later ledger and attendance rows carry the new balance; a poly fee change can add or take back an override fill
  attendance: any[];
  financials: any[];
  polyOverride: PolyFeeOverride | null;
}

interface Props {
  client: any;
  role: string;
  userEmail: string;
  // The client's ledger, loaded by App with the account
  financials: any[];
  // The slot this client is booked into, if any (poly fee changes can't return the vouchers it used)
  bookedSlot: any | null;
  canViewSlot: boolean;
  onViewSlot: (slotId: number) => void;
  onPaymentChanged: (refresh: LedgerRefresh) => void;
  onSuccess: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type PaymentActionKind = 'adjust' | CardPaymentAction;

const ACTION_TITLES: Record<PaymentActionKind, string> = { adjust: 'Adjust cash payment', refund: 'Refund', dispute: 'Dispute (owed again until won)', 'dispute-won': 'Dispute won: apply the payment again', 'dispute-lost': 'Dispute lost' };
const ACTION_SUBMIT_LABELS: Record<PaymentActionKind, string> = { adjust: 'Save Adjustment', refund: 'Record Refund', dispute: 'Record Dispute', 'dispute-won': 'Mark Won', 'dispute-lost': 'Mark Lost' };

// The Financial Ledger tab of a client's account: entries by month, and (Business Administrators) corrections to a
// payment: adjust a cash payment, or refund, dispute, and settle a dispute on a card payment
export default function ClientLedger({ client, role, userEmail, financials, bookedSlot, canViewSlot, onViewSlot, onPaymentChanged, onSuccess }: Props) {
  const employeeLabel = useEmployeeLabel();
  const [filters, setFilters] = useState(EMPTY_LEDGER_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // Months (YYYY-MM) the user has collapsed
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());
  // Payment being corrected: a cash adjustment, or a refund or dispute step on a card payment
  const [paymentAction, setPaymentAction] = useState<{ id: number; kind: PaymentActionKind; amount: string; reason: string } | null>(null);
  const [paymentActionError, setPaymentActionError] = useState('');
  const [saving, setSaving] = useState(false);
  // Shown after a poly fee payment change when the client is already booked into a polygraph with vouchers
  const [scheduledPolyNotice, setScheduledPolyNotice] = useState<{ slotId: number; text: string } | null>(null);

  const isAdmin = role === 'Business Administrator';
  const search = filters.search.trim().toLowerCase();
  const shown = financials.filter(f => {
    const day = localYmd(f.date);
    if (filters.type && f.type !== filters.type) return false;
    if (filters.feeType && f.feetype !== filters.feeType) return false;
    if (filters.method && f.paymentmethod !== filters.method) return false;
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    if (search && ![f.comments, f.feetype, f.type, f.paymentmethod, Number(f.amount).toFixed(2)].some(v => String(v ?? '').toLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => {
    if (filters.sort === 'amount-high') return Number(b.amount) - Number(a.amount);
    if (filters.sort === 'amount-low') return Number(a.amount) - Number(b.amount);
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    return filters.sort === 'oldest' ? diff : -diff;
  });
  // Filters set but hidden are counted on the button so they aren't forgotten
  const activeFilterCount = [filters.search.trim(), filters.type, filters.feeType, filters.method, filters.from, filters.to].filter(Boolean).length;

  const handlePaymentAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentAction) return;
    const { id, kind } = paymentAction;
    const reason = paymentAction.reason.trim();
    const amount = Number(paymentAction.amount);
    const needsAmount = kind === 'adjust' || kind === 'refund' || kind === 'dispute';
    if ((needsAmount && !(amount > 0)) || !reason) return;
    const clientid = client.clientid;
    setSaving(true);
    setPaymentActionError('');
    try {
      const res: PaymentChangeResult = kind === 'adjust'
        ? await adjustCashPayment(id, { amount, reason, user: userEmail })
        : await recordCardPaymentAction(id, { action: kind, amount: needsAmount ? amount : undefined, reason, user: userEmail });
      const changes: Record<string, unknown> = { accountbalance: res.newBalance };
      if (res.polyFeePaid !== undefined) changes.polyfeepaid = res.polyFeePaid;
      if (res.polyFeeVoucher !== undefined) changes.polyfeevoucher = res.polyFeeVoucher;
      setPaymentAction(null);
      const what = {
        adjust: `Payment adjusted to ${formatMoney(amount)}.`,
        refund: `Refund of ${formatMoney(amount)} recorded.`,
        dispute: `Dispute of ${formatMoney(amount)} recorded; the amount is owed again until the dispute is won.`,
        'dispute-won': 'Dispute marked won; the payment is applied again.',
        'dispute-lost': 'Dispute marked lost.',
      }[kind];
      onSuccess(`${what} Updated Balance: ${formatBalance(res.newBalance)}.`
        + (res.vouchersRemoved ? ` ${res.vouchersRemoved} poly fee voucher(s) removed.` : '')
        + (res.vouchersAdded ? ' Poly fee paid in full; vouchers filled.' : '')
        + (res.owedOnAccount ? ` ${formatMoney(res.owedOnAccount)} more than was paid on the poly fee is owed on the account.` : '')
        + (res.attendanceUpdated ? ' The check-in it was taken at and the Group Income Report were updated too.' : ''));
      if (res.scheduledPolygraph) {
        const p = res.scheduledPolygraph;
        setScheduledPolyNotice({
          slotId: p.slotId,
          text: `This client already has a polygraph scheduled ${new Date(`${p.date}T00:00:00`).toLocaleDateString()}${p.time ? ` @ ${formatDisplayTime(p.time)}` : ''}${p.location ? ` (${p.location})` : ''} using poly fee vouchers. Changing the poly fee payment did not cancel it or return the vouchers.`,
        });
      }
      const [attendance, fin, poly] = await Promise.all([getClientAttendance(clientid), getClientFinancials(clientid), fetchPolyFeeOverride(clientid)]);
      onPaymentChanged({ clientId: clientid, changes, attendance, financials: fin, polyOverride: poly.override });
    } catch (err) {
      setPaymentActionError(err instanceof Error && err.message ? err.message : 'Could not save the change.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {scheduledPolyNotice && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 text-sm text-amber-300 flex items-start justify-between gap-3">
          <p><AlertCircle size={15} className="inline mr-1.5 -mt-0.5" />{scheduledPolyNotice.text}</p>
          <div className="shrink-0 flex items-center gap-3">
            {canViewSlot && (
              <button type="button" onClick={() => onViewSlot(scheduledPolyNotice.slotId)} className="text-xs font-semibold underline hover:text-white">View Slot</button>
            )}
            <button type="button" onClick={() => setScheduledPolyNotice(null)} aria-label="Dismiss" className="hover:text-white"><X size={15} /></button>
          </div>
        </div>
      )}
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
          {shown.length === financials.length ? `${financials.length} entries` : `Showing ${shown.length} of ${financials.length}`}
        </span>
      </div>
      {showFilters && <RecordFilterBar
        search={filters.search}
        onSearch={v => setFilters(f => ({ ...f, search: v }))}
        searchPlaceholder="Comments, fee type, amount..."
        selects={[
          { label: 'Type', value: filters.type, onChange: v => setFilters(f => ({ ...f, type: v })), allLabel: 'All Types', options: sortedUnique(financials.map(f => f.type)) },
          { label: 'Fee Type', value: filters.feeType, onChange: v => setFilters(f => ({ ...f, feeType: v })), allLabel: 'All Fee Types', options: sortedUnique(financials.map(f => f.feetype)) },
          { label: 'Method', value: filters.method, onChange: v => setFilters(f => ({ ...f, method: v })), allLabel: 'All Methods', options: sortedUnique(financials.map(f => f.paymentmethod)) },
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
          { value: 'amount-high', label: 'Amount: High to Low' },
          { value: 'amount-low', label: 'Amount: Low to High' },
        ]}
        shown={shown.length}
        total={financials.length}
        onClear={() => setFilters(f => ({ ...EMPTY_LEDGER_FILTERS, sort: f.sort }))}
      />}
      {shown.length === 0 && financials.length > 0 && (
        <p className="text-center text-slate-500 text-sm py-4">No ledger entries match these filters.</p>
      )}
      {groupByMonth(shown, filters.sort).map(month => {
        const charges = month.rows.filter(f => f.type === 'Charge').reduce((t, f) => t + Number(f.amount || 0), 0);
        // Net of refunds and disputes
        const payments = month.rows.filter(f => f.type !== 'Charge')
          .reduce((t, f) => t + (PAYMENT_REVERSAL_TYPES.includes(f.type) ? -1 : 1) * Number(f.amount || 0), 0);
        const collapsed = collapsedMonths.has(month.key);
        return (
          <div key={month.key} className="space-y-2">
            <MonthHeader label={month.label} count={month.rows.length} noun="entry" collapsed={collapsed} onToggle={() => setCollapsedMonths(prev => toggleInSet(prev, month.key))}>
              <span className="text-slate-500">Fees <span className={`font-semibold ${charges > 0 ? 'text-red-400' : 'text-slate-400'}`}>{charges > 0 ? '-' : ''}{signedMoney(charges)}</span></span>
              <span className="text-slate-500">Payments <span className={`font-semibold ${payments > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>{payments > 0 ? '+' : ''}{signedMoney(payments)}</span></span>
            </MonthHeader>
            {!collapsed && month.rows.map(fin => {
              // Charges (fees) are red and refunds/disputes amber, both adding to what's owed; payments are green and take away from it
              const charge = fin.type === 'Charge';
              const reversal = PAYMENT_REVERSAL_TYPES.includes(fin.type);
              const minus = charge || reversal;
              const tone = charge ? LEDGER_TONES.charge : reversal ? LEDGER_TONES.reversal : LEDGER_TONES.payment;
              const badge = charge ? 'Fee' : fin.type === 'Payment' ? 'Payment' : fin.type;
              const isPoly = fin.feetype === 'Poly Fee';
              // Payments saved before the method was recorded were all cash
              const canAdjust = isAdmin && fin.type === 'Payment' && (!fin.paymentmethod || fin.paymentmethod === 'Cash');
              const card = fin.type === 'Payment' && fin.paymentmethod === 'Credit Card' ? cardPaymentStatus(fin, financials) : null;
              const disputeOpen = fin.disputestatus === 'Open';
              const action = paymentAction?.id === fin.transactionid ? paymentAction : null;
              const startAction = (kind: PaymentActionKind, amount: number) => {
                setPaymentAction({ id: fin.transactionid, kind, amount: amount > 0 ? amount.toFixed(2) : '', reason: '' });
                setPaymentActionError('');
              };
              const linkClass = 'inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white';
              const balance = ledgerBalanceChange(fin);
              return (
                <div key={fin.transactionid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-white">
                        {fin.feetype || fin.type}
                        <span className={`ml-2 align-middle text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${tone.badge}`}>{badge}</span>
                        {!charge && fin.paymentmethod && (
                          <span className="ml-2 align-middle text-[10px] uppercase tracking-wide bg-slate-800 text-slate-300 px-2 py-0.5 rounded">{fin.paymentmethod}</span>
                        )}
                        {fin.disputestatus && (
                          <span className={`ml-2 align-middle text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${disputeOpen ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' : fin.disputestatus === 'Won' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-red-400 bg-red-500/10 border-red-500/30'}`}>Dispute {fin.disputestatus}</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">{new Date(fin.date).toLocaleString()} — {fin.comments}</p>
                      {fin.adjustedon && (
                        <p className="text-xs text-amber-400 mt-1">
                          Adjusted from {formatMoney(Number(fin.originalamount))} by {employeeLabel(fin.adjustedby)} on {new Date(fin.adjustedon).toLocaleDateString()}{fin.adjustmentreason ? `: ${fin.adjustmentreason}` : ''}
                        </p>
                      )}
                      {card && card.kept < Number(fin.amount) && (
                        <p className="text-xs text-amber-400 mt-1">
                          {card.refunded > 0 && <>Refunded {formatMoney(card.refunded)}. </>}
                          {card.openDispute > 0 && <>{formatMoney(card.openDispute)} in dispute. </>}
                          Kept {formatMoney(card.kept)} of {formatMoney(Number(fin.amount))}.
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0 pl-4">
                      <p className={`font-bold ${tone.text}`}>{minus ? '-' : '+'}${Number(fin.amount).toFixed(2)}</p>
                      {balance && (
                        <p className={`text-xs mt-1 ${balance.after < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {balance.changesBalance ? <>Balance {signedMoney(balance.before)} → {signedMoney(balance.after)}</> : <>Balance unchanged: {signedMoney(balance.after)}</>}
                        </p>
                      )}
                      {!action && (
                        <div className="mt-1 flex justify-end gap-3">
                          {canAdjust && <button type="button" onClick={() => startAction('adjust', Number(fin.amount))} className={linkClass}><Pencil size={12} /> Adjust</button>}
                          {isAdmin && card && !disputeOpen && card.kept > 0 && (
                            <>
                              <button type="button" onClick={() => startAction('refund', card.kept)} className={linkClass}>Refund</button>
                              <button type="button" onClick={() => startAction('dispute', card.kept)} className={linkClass}>Dispute</button>
                            </>
                          )}
                          {isAdmin && card && disputeOpen && (
                            <>
                              <button type="button" onClick={() => startAction('dispute-won', 0)} className={linkClass}>Dispute Won</button>
                              <button type="button" onClick={() => startAction('dispute-lost', 0)} className={linkClass}>Dispute Lost</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {action && (() => {
                    const needsAmount = action.kind === 'adjust' || action.kind === 'refund' || action.kind === 'dispute';
                    const entered = Number(action.amount) || 0;
                    const max = action.kind === 'adjust' ? Infinity : card?.kept ?? 0;
                    // Change to what was paid on this payment: positive means the client paid more
                    const paidChange = action.kind === 'adjust' ? entered - Number(fin.amount)
                      : action.kind === 'dispute-won' ? (card?.openDispute ?? 0)
                      : action.kind === 'dispute-lost' ? 0
                      : -entered;
                    const amountOk = !needsAmount || (entered > 0 && entered <= max + 0.005 && (action.kind !== 'adjust' || Math.abs(paidChange) >= 0.005));
                    let preview: React.ReactNode = null;
                    if (action.kind === 'dispute-lost') {
                      preview = <>The disputed {formatMoney(card?.openDispute ?? 0)} stays owed{isPoly ? ' on the poly fee' : ''}.</>;
                    } else if (Math.abs(paidChange) >= 0.005 && isPoly) {
                      const fee = Number(client.polyfee || 0);
                      const paidBefore = Number(client.polyfeepaid || 0);
                      // Poly fee paid stops at $0; the rest is owed on the account (the server splits it the same way)
                      const polyChange = paidChange < 0 ? Math.max(paidChange, -Math.max(paidBefore, 0)) : paidChange;
                      const owedOnAccount = Math.round((polyChange - paidChange) * 100) / 100;
                      const paidAfter = paidBefore + polyChange;
                      const wasFull = fee > 0 && paidBefore >= fee;
                      const isFull = fee > 0 && paidAfter >= fee;
                      preview = <>
                        Poly fee paid {formatMoney(paidBefore)} → {formatMoney(paidAfter)} of {formatMoney(fee)}.
                        {wasFull && !isFull && <span className="text-amber-400"> No longer paid in full: the vouchers that paying in full added are removed.</span>}
                        {!wasFull && isFull && <span className="text-emerald-400"> Paid in full: vouchers fill to {polyVoucherMax(client.phase)}.</span>}
                        {owedOnAccount > 0 && (
                          <span className="text-amber-400"> {formatMoney(owedOnAccount)} more than was paid on the poly fee is owed on the account: balance {formatBalance(client.accountbalance)} → {formatBalance(Number(client.accountbalance || 0) + owedOnAccount)}.</span>
                        )}
                      </>;
                    } else if (Math.abs(paidChange) >= 0.005) {
                      const newBalance = Number(client.accountbalance || 0) - paidChange;
                      preview = <>
                        Balance {formatBalance(client.accountbalance)} → {formatBalance(newBalance)}.
                        {action.kind === 'adjust' ? ' Later ledger and attendance balances move by the same amount.' : ['Group Fee', 'Assessment Fee', 'Individual Fee'].includes(fin.feetype) ? ' The check-in it was taken at and the Group Income Report are updated too.' : ''}
                      </>;
                    }
                    return (
                      <form onSubmit={handlePaymentAction} className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                        <p className="text-xs font-semibold text-slate-300">{ACTION_TITLES[action.kind]}</p>
                        <div className="flex flex-wrap gap-2">
                          {needsAmount && (
                            <div className="relative w-36">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                max={Number.isFinite(max) ? max : undefined}
                                value={action.amount}
                                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                                onChange={(e) => setPaymentAction({ ...action, amount: e.target.value.replace(/-/g, '') })}
                                aria-label={action.kind === 'adjust' ? 'Correct payment amount' : 'Amount'}
                                autoFocus
                                required
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-7 pr-3 text-white text-sm"
                              />
                            </div>
                          )}
                          <input
                            type="text"
                            value={action.reason}
                            onChange={(e) => setPaymentAction({ ...action, reason: e.target.value })}
                            placeholder="Reason…"
                            autoFocus={!needsAmount}
                            required
                            className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm"
                          />
                        </div>
                        {needsAmount && Number.isFinite(max) && <p className="text-xs text-slate-500">Up to {formatMoney(max)} (what's left of this payment).</p>}
                        {preview && <p className="text-xs text-slate-400">{preview}</p>}
                        {/* Booking the polygraph already used the vouchers, so changing this payment can't take them back */}
                        {isPoly && action.kind !== 'dispute-lost' && bookedSlot && (
                          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-2.5 text-xs text-amber-300 flex items-start justify-between gap-3">
                            <p>
                              <AlertCircle size={13} className="inline mr-1 -mt-0.5" />
                              This client already has a polygraph scheduled ({slotSummary(bookedSlot)}) using poly fee vouchers.
                              Changing this payment won't cancel it or return those vouchers.
                            </p>
                            {canViewSlot && (
                              <button type="button" onClick={() => onViewSlot(bookedSlot.slotid)} className="shrink-0 underline hover:text-white">View Slot</button>
                            )}
                          </div>
                        )}
                        {paymentActionError && <p className="text-xs text-red-400">{paymentActionError}</p>}
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => { setPaymentAction(null); setPaymentActionError(''); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Cancel</button>
                          <button
                            type="submit"
                            disabled={saving || !amountOk || !action.reason.trim()}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                          >
                            {ACTION_SUBMIT_LABELS[action.kind]}
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
