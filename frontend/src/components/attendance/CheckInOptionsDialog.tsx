import { useState } from 'react';
import { clientFee, feeAlreadyCharged, type ClientRecord, type PaymentMethod, type PaymentTerms } from '../../hooks/useGroupCheckIn';
import { submitAccountPayment } from '../../api';
import { FIRST_CHECKIN_MAX_OWED, allowedOwed, balanceColor, checkInPaymentRule, formatBalance, formatBalanceLabeled, minimumCheckInPayment } from '../../utils/balance';
import { feePeriodMonths } from '../../utils/soPhases';
import { FEDERAL_PROGRAM_TYPES, federalGroupFee, individualSessionFee, idText } from '../../utils/clients';
import { printReceipt, type Receipt } from '../../utils/receipt';
import { cardBlocked, cardBlockedText } from '../../utils/cardBlock';
import CardPaymentFields from '../payments/CardPaymentFields';
import OtherPaymentFields from '../payments/OtherPaymentFields';
import { PAYMENT_METHODS, paymentMethodProblem } from '../../utils/paymentMethods';
import { useUserRole } from '../../hooks/useUserRole';
import { emptyCardBilling, type CardBilling } from '../payments/cardBilling';

interface Props {
  clients: ClientRecord[];
  createdBy: string;
  onConfirm: (terms: Record<number, PaymentTerms>) => void;
  onCancel: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onProcessed: () => void;
  // Set for a counselor's individual group: everyone is charged this Admin Individual price, and the balance rule counts
  // the client's first individual session of the month (not group attendance)
  individualFee?: number | null;
}

// Inputs are kept as text so a field can be cleared while typing.
interface Row {
  payment: string;
  paymentMethod: PaymentMethod;
  // Other payments: the kind (Check, DHS, ...) and an optional reference #
  paymentSubtype: string;
  paymentReference: string;
  voucher: boolean;
  card: CardBilling;
  processing: boolean;
  receipt: Receipt | null;
}


// Explains the fee line: where it comes from, or why nothing is charged
const feeLabel = (c: ClientRecord, fee: number): string => {
  if (federalGroupFee(c.programtype, c.groupcopay, Boolean(c.attendedthismonth)) !== null) {
    if (fee > 0) return c.programtype === 'Federal SO' ? 'Group copay (first group of the month)' : 'Group copay (each drug test)';
    return c.programtype === 'Federal SO' && c.attendedthismonth && Number(c.groupcopay || 0) > 0
      ? 'Group copay already charged this month (nothing charged)' : 'No group copay on account (nothing charged)';
  }
  if (fee > 0) return 'Treatment fee (from account)';
  if (feeAlreadyCharged(c)) {
    const months = feePeriodMonths(c.programtype, c.phase);
    return months ? `Already charged in the last ${months} months (nothing charged)` : 'Already charged this month (nothing charged)';
  }
  return 'No treatment fee on account (nothing charged)';
};
// How much a client still has to pay before the check-in is allowed (0 when they may check in), by their payment rule
// (checkInPaymentRule): Chaperon attendances are paid the day of them, others need the balance paid on their first group
// check-in of the month, BIP clients have no requirement, and federal clients have none unless a Max Debt Override caps
// what a copay may leave them owing. Balances are in the stored sign (positive = owes);
// a processed card payment is already in the balance. A card amount counts only once the card is processed.
// Individual sessions count the client's first individual session of the month. A Max Debt Override (maxowed) raises
// how much the client may owe.
const alreadyThisMonth = (c: ClientRecord, individual: boolean) => Boolean(individual ? c.individualthismonth : c.attendedthismonth);
const amountStillOwedToCheckIn = (c: ClientRecord, row: Row, fee: number, individual: boolean): number => {
  // Cash and Other (check, money order, ...) payments are taken now and recorded when the group closes
  const cashNow = row.paymentMethod !== 'Credit Card' && !row.receipt ? (parsePayment(row) ?? 0) : 0;
  const balance = row.receipt ? row.receipt.newBalance : Number(c.accountbalance || 0);
  return Math.max(0, Math.round((minimumCheckInPayment(checkInPaymentRule(c.programtype), balance, fee, alreadyThisMonth(c, individual), c.maxowed) - cashNow) * 100) / 100);
};

const inputClass ='w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm';

// Returns the parsed payment for one row, or null if the payment is not a valid amount.
const parsePayment = (row: Row): number | null => {
  const payment = row.payment.trim() === '' ? 0 : Number(row.payment);
  return Number.isFinite(payment) && payment >= 0 ? payment : null;
};

// A card amount only counts once it is processed, so an amount that hasn't been must be processed or cleared before moving on.
const cardNotProcessed = (row: Row): boolean =>
  row.paymentMethod === 'Credit Card' && !row.receipt && (parsePayment(row) ?? 0) > 0;

// Steps through the clients one at a time. Each client must be valid before moving on, and nothing
// is checked in until the last client is confirmed.
export default function CheckInOptionsDialog({ clients, createdBy, onConfirm, onCancel, onSuccess, onError, onProcessed, individualFee = null }: Props) {
  const individual = individualFee !== null;
  const [rows, setRows] = useState<Record<number, Row>>(() =>
    Object.fromEntries(clients.map(c => [c.clientid, {
      payment: '', paymentMethod: 'Cash' as PaymentMethod, paymentSubtype: '', paymentReference: '', voucher: false, card: emptyCardBilling, processing: false, receipt: null,
    }]))
  );
  const [step, setStep] = useState(0);
  const role = useUserRole();
  // An Other payment with an amount needs its kind, one this role may record
  const otherProblem = (row: Row) => ((parsePayment(row) ?? 0) > 0 && !row.receipt
    ? paymentMethodProblem(row.paymentMethod, row.paymentSubtype, role) : null);

  const updateRow = (clientId: number, patch: Partial<Row>) => {
    setRows(prev => ({ ...prev, [clientId]: { ...prev[clientId], ...patch } }));
  };

  // Card payments are saved right away from this screen. Once processed, the amount is already on the
  // client's account and stays there even if the check-in is canceled, so the check-in itself records
  // no payment for that client.
  const processCardPayment = async (c: ClientRecord) => {
    const row = rows[c.clientid];
    const amount = parsePayment(row);
    if (amount === null || amount <= 0) return;

    updateRow(c.clientid, { processing: true });
    try {
      const res = await submitAccountPayment({
        client: c.clientid,
        amount,
        comments: 'Card payment processed at group check-in.',
        createdBy,
        paymentMethod: 'Credit Card',
      });
      updateRow(c.clientid, {
        processing: false,
        receipt: {
          clientName: `${c.lastname}, ${c.firstname}`,
          docNumber: idText(c),
          amount,
          method: 'Credit Card',
          newBalance: Number(res.newBalance),
          transactionIds: res.transactionIds,
          processedBy: createdBy,
          date: new Date().toLocaleString(),
        },
      });
      onSuccess(`Card payment processed for ${c.firstname} ${c.lastname}.`);
      onProcessed();
    } catch (err: unknown) {
      updateRow(c.clientid, { processing: false });
      onError(err instanceof Error && err.message ? err.message : 'Payment could not be processed.');
    }
  };

  const invalid = clients.some(c => {
    const row = rows[c.clientid];
    return (!row.receipt && parsePayment(row) === null) || cardNotProcessed(row) || otherProblem(row) !== null;
  });
  // Clients whose balance is too far behind for their first check-in of the month
  const feeFor = (c: ClientRecord) => (individual ? individualSessionFee(c, individualFee) : clientFee(c));
  const blocked = clients.filter(c => amountStillOwedToCheckIn(c, rows[c.clientid], feeFor(c), individual) > 0);

  const confirm = () => {
    if (invalid || blocked.length > 0) return;
    const terms = Object.fromEntries(clients.map(c => {
      const row = rows[c.clientid];
      const payment = row.receipt ? 0 : (parsePayment(row) ?? 0);
      return [c.clientid, {
        payment,
        paymentMethod: row.paymentMethod,
        paymentSubtype: row.paymentMethod === 'Other' ? row.paymentSubtype : null,
        paymentReference: row.paymentMethod === 'Other' ? row.paymentReference.trim() || null : null,
        voucher: row.voucher,
        cardPaid: row.receipt ? row.receipt.amount : 0,
        cardTransactionIds: row.receipt?.transactionIds ?? [],
        // Card payments are already saved, so the balance here already reflects them
        balance: row.receipt ? row.receipt.newBalance : Number(c.accountbalance || 0),
      }];
    })) as Record<number, PaymentTerms>;
    onConfirm(terms);
  };

  const c = clients[step];
  const row = rows[c.clientid];
  const isLastStep = step === clients.length - 1;
  const locked = row.receipt !== null;
  const rowValid = locked || parsePayment(row) !== null;
  const canProcess = row.paymentMethod === 'Credit Card' && !locked && !row.processing && (parsePayment(row) ?? 0) > 0;
  // Balances are in the stored sign (positive = owes). A processed card payment is already on the account,
  // so the balance starts from the post-payment figure and nothing more is paid in this check-in.
  const baseBalance = locked ? row.receipt!.newBalance : Number(c.accountbalance || 0);
  const paymentNow = locked ? row.receipt!.amount : (parsePayment(row) ?? 0);
  // Each client's fee comes from their own account
  const fee = feeFor(c);
  const federalCopay = individual && FEDERAL_PROGRAM_TYPES.includes(c.programtype || '');
  const afterCheckIn = baseBalance + fee - (locked ? 0 : paymentNow);
  const rule = checkInPaymentRule(c.programtype);
  const stillOwed = amountStillOwedToCheckIn(c, row, fee, individual);
  const minimumPayment = minimumCheckInPayment(rule, c.accountbalance, fee, alreadyThisMonth(c, individual), c.maxowed);
  const hasDebtLimit = Number(c.maxowed) > 0;
  // "$0.00 or better", or the most they may owe under a Max Debt Override
  const allowedText = hasDebtLimit ? `owing at most $${allowedOwed(c.maxowed).toFixed(2)} (Max Debt Override)` : `${formatBalance(FIRST_CHECKIN_MAX_OWED)} or better`;
  const cardPending = cardNotProcessed(row);
  const methodProblem = otherProblem(row);
  const canContinue = rowValid && stillOwed === 0 && !cardPending && !row.processing && !methodProblem;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="check-in-options-title">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85dvh] flex flex-col">
        <header className="p-5 border-b border-slate-800">
          <div className="flex justify-between items-baseline gap-3">
            <h3 id="check-in-options-title" className="font-semibold text-white">Check-In Details</h3>
            <p className="text-xs font-semibold text-blue-400 whitespace-nowrap">Client {step + 1} of {clients.length}</p>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Set this client's payment, then continue to the next. Leave payment blank if nothing is paid at check-in. Credit card payments are applied to the account as soon as they are processed, even if the client isn't checked in.
          </p>
          {clients.length > 1 && (
            <div className="flex gap-1 mt-3" aria-hidden="true">
              {clients.map((client, i) => (
                <div key={client.clientid} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-blue-500' : 'bg-slate-800'}`} />
              ))}
            </div>
          )}
        </header>

        {/* Keyed by client so each step starts at the top with the payment field focused */}
        <div key={c.clientid} className="p-5 space-y-3 overflow-y-auto">
          <article className={`bg-slate-950 border rounded-lg p-4 ${rowValid && stillOwed === 0 ? 'border-slate-800' : 'border-red-500/50'}`}>
            <div className="flex justify-between items-baseline gap-3 mb-3">
              <p className="font-semibold text-white truncate">{c.lastname}, {c.firstname}</p>
              <p className="text-xs text-slate-400 whitespace-nowrap">ID # {idText(c) || '—'} · Balance {formatBalanceLabeled(c.accountbalance)}</p>
            </div>
            {cardBlocked(c) && (
              <p className="mb-3 text-xs text-amber-400">{cardBlockedText(c)}</p>
            )}
            {stillOwed > 0 && (
              <div className="mb-3 bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-xs text-red-300">
                {rule === 'federal'
                  ? <>{c.firstname} has a Max Debt Override. The balance after check-in, including today's copay, must be {allowedText}.</>
                  : rule === 'each'
                  ? <>Chaperon attendance is paid the day of it. The balance after check-in, including today's fee, must be {allowedText}.</>
                  : <>This is {c.firstname}'s first {individual ? 'individual session' : 'group check-in'} this month. The balance before today's fee must be {allowedText} to be checked in.</>}
                {' '}A payment of at least <strong>${minimumPayment.toFixed(2)}</strong> is
                required{row.paymentMethod === 'Credit Card' ? ', and the card must be processed before check-in' : ''}.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300 items-end">
              <label className="flex flex-col gap-1">
                <span>Payment ($){minimumPayment > 0 && !locked && <span className="text-red-400"> · min ${minimumPayment.toFixed(2)}</span>}</span>
                <input type="number" step="0.01" autoFocus min={minimumPayment > 0 ? minimumPayment : 0} placeholder={minimumPayment > 0 ? minimumPayment.toFixed(2) : '0.00'} disabled={locked} value={row.payment} onChange={e => updateRow(c.clientid, { payment: e.target.value })} className={`${inputClass} disabled:opacity-50`} />
              </label>
              <div className="flex flex-col gap-1">
                Payment Method
                <div className="grid grid-cols-3 gap-1.5">
                  {PAYMENT_METHODS.map(method => (
                    <button
                      key={method}
                      type="button"
                      disabled={locked || (method === 'Credit Card' && cardBlocked(c))}
                      onClick={() => updateRow(c.clientid, { paymentMethod: method })}
                      title={method === 'Credit Card' && cardBlocked(c) ? cardBlockedText(c) : undefined}
                      className={`border rounded-lg py-2 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${row.paymentMethod === method ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 pb-2">
                <input type="checkbox" checked={row.voucher} onChange={e => updateRow(c.clientid, { voucher: e.target.checked })} className="rounded accent-blue-500" />
                Apply Voucher
              </label>
            </div>

            <div className="mt-3 bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Current balance</span>
                <span className={balanceColor(baseBalance)}>{formatBalance(baseBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{federalCopay ? (fee > 0 ? 'Individual copay (federal client)' : 'Federal client: no individual copay (nothing charged)') : individual ? 'Individual session (price from Admin)' : feeLabel(c, fee)}</span>
                <span className={balanceColor(fee)}>{formatBalance(fee)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{locked ? 'Payment (processed)' : 'This payment'}</span>
                <span className={balanceColor(-paymentNow)}>{formatBalance(-paymentNow)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-1.5">
                <span className="font-semibold text-slate-300">Balance after check-in</span>
                <span className={`font-bold ${balanceColor(afterCheckIn)}`}>{formatBalance(afterCheckIn)}</span>
              </div>
            </div>

            {row.paymentMethod === 'Other' && !locked && (
              <div className="mt-3">
                <OtherPaymentFields
                  subtype={row.paymentSubtype}
                  reference={row.paymentReference}
                  onChange={patch => updateRow(c.clientid, {
                    ...(patch.subtype !== undefined ? { paymentSubtype: patch.subtype } : {}),
                    ...(patch.reference !== undefined ? { paymentReference: patch.reference } : {}),
                  })}
                  inputClass={inputClass}
                />
              </div>
            )}

            {row.paymentMethod === 'Credit Card' && (
              <div className="mt-3 space-y-3">
                <CardPaymentFields value={row.card} onChange={card => updateRow(c.clientid, { card })} />
                <div className="flex flex-wrap justify-end items-center gap-2">
                  {locked && <span className="text-xs text-emerald-400 mr-auto">Payment processed and applied to account</span>}
                  <button
                    type="button"
                    onClick={() => printReceipt(row.receipt as Receipt, onError)}
                    disabled={!locked}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Print Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => processCardPayment(c)}
                    disabled={!canProcess}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {row.processing ? 'Processing...' : 'Process Payment'}
                  </button>
                </div>
              </div>
            )}
          </article>
        </div>

        <footer className="p-5 border-t border-slate-800 flex flex-wrap justify-between items-center gap-3">
          <p className={`text-xs ${!rowValid || stillOwed > 0 || cardPending || methodProblem ? 'text-red-400' : 'text-slate-500'}`}>
            {!rowValid
              ? 'Enter a payment of 0 or more.'
              : methodProblem
                ? methodProblem
              : stillOwed > 0
                ? `${c.lastname}, ${c.firstname} must pay at least the minimum payment before checking in.`
                : cardPending
                  ? 'Press Process Payment to apply the card payment, or clear the amount.'
                  : isLastStep
                    ? `${clients.length} client(s) ready to check in.`
                    : `Next: ${clients[step + 1].lastname}, ${clients[step + 1].firstname}`}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} disabled={row.processing} className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">Back</button>
            )}
            {isLastStep ? (
              <button type="button" onClick={confirm} disabled={!canContinue || invalid || blocked.length > 0} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                Confirm Check-In ({clients.length})
              </button>
            ) : (
              <button type="button" onClick={() => setStep(step + 1)} disabled={!canContinue} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                Next Client
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
