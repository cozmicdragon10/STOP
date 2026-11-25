import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { checkDepositAgainstBank, setDepositSlip, voidBankDeposit } from '../../api';
import type { BankDeposit } from '../../api';
import { errorMessage } from '../../utils/errors';
import { depositDifference, depositStatus, depositStatusText, moneyText, sameEmail, shortDate } from '../../utils/moneyOnHand';
import { askConfirm } from '../../utils/confirm';

const TONE = {
  waiting: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  balanced: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  short: 'text-red-300 bg-red-500/10 border-red-500/30',
  over: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  voided: 'text-slate-400 bg-slate-800 border-slate-700',
};

const inputClass = 'h-8 bg-slate-900 border border-slate-700 rounded px-2 text-white text-xs';
const buttonClass = 'px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40';

interface Props {
  deposit: BankDeposit;
  userEmail: string;
  isAdmin: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}

// One trip to the bank: what went in it, and its bank check. The person who dropped it off (or a Business
// Administrator) can fix the slip number until it's checked; a Business Administrator enters what the bank credited,
// clears that, or voids a deposit that wasn't checked yet (its money goes back on hand).
export default function DepositCard({ deposit: d, userEmail, isAdmin, onChanged, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<null | 'slip' | 'check' | 'void'>(null);
  const [slip, setSlip] = useState(d.slipnumber || '');
  const [bankAmount, setBankAmount] = useState(String(Number(d.total).toFixed(2)));
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const status = depositStatus(d);
  const settled = status !== 'waiting';
  const canEditSlip = !settled && (isAdmin || sameEmail(d.droppedoffby, userEmail));
  const diff = depositDifference(d);

  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await work();
      setForm(null);
      onChanged(message);
    } catch (err) {
      onError(errorMessage(err, 'Failed to save.'));
    } finally {
      setBusy(false);
    }
  };

  const label = `Deposit ${d.slipnumber ? `slip ${d.slipnumber}` : `#${d.bankdepositid}`}`;

  return (
    <li className={`bg-slate-950 border rounded-lg text-xs ${status === 'voided' ? 'border-slate-800 opacity-70' : 'border-slate-800'}`}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full text-left p-3 flex items-start gap-2">
        {open ? <ChevronDown size={14} className="mt-0.5 text-slate-500 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 text-slate-500 shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm font-semibold text-white">{shortDate(d.depositdate)} · {d.slipnumber ? `Slip ${d.slipnumber}` : <span className="text-slate-400 font-normal">No slip #</span>}</span>
            <span className={`text-sm font-bold ${status === 'voided' ? 'line-through text-slate-500' : 'text-emerald-400'}`}>{moneyText(d.total)}</span>
          </span>
          <span className="block text-slate-400 mt-0.5">
            Dropped off by {d.droppedoffbyname} · {d.items?.length || 0} item{d.items?.length === 1 ? '' : 's'}
          </span>
          <span className={`inline-block mt-1.5 px-2 py-0.5 rounded border ${TONE[status]}`}>{depositStatusText(d)}</span>
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <ul className="divide-y divide-slate-800 border-y border-slate-800">
            {(d.items || []).map(i => (
              <li key={i.key} className="flex justify-between gap-2 py-1.5">
                <span className="text-slate-200 min-w-0">
                  {i.label}
                  {i.collectorName && <span className="block text-slate-500">collected by {i.collectorName}</span>}
                </span>
                <span className="text-slate-300 shrink-0">{moneyText(i.amount)}</span>
              </li>
            ))}
          </ul>

          {d.verifiedon && (
            <p className="text-slate-400">
              {d.verifiedbyname} checked it against the bank on {new Date(d.verifiedon).toLocaleDateString()}: {moneyText(d.bankamount)} credited
              {diff !== null && diff !== 0 && <span className={diff < 0 ? 'text-red-300' : 'text-sky-300'}> ({diff < 0 ? 'short' : 'over'} {moneyText(Math.abs(diff))})</span>}.
              {d.verifynotes && <span className="block text-slate-300 mt-0.5">“{d.verifynotes}”</span>}
            </p>
          )}
          {d.voidedon && (
            <p className="text-slate-400">
              Voided by {d.voidedbyname} on {new Date(d.voidedon).toLocaleDateString()}{d.voidreason ? `: “${d.voidreason}”` : ''}. Its money went back on hand.
            </p>
          )}

          {form === 'slip' && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-slate-400">Slip number
                <input value={slip} onChange={e => setSlip(e.target.value)} maxLength={100} className={`block mt-1 w-40 ${inputClass}`} />
              </label>
              <button type="button" disabled={busy} onClick={() => run(() => setDepositSlip(d.bankdepositid, slip), `${label}: slip number saved.`)}
                className={`${buttonClass} bg-blue-600 hover:bg-blue-500 text-white`}>Save</button>
              <button type="button" disabled={busy} onClick={() => setForm(null)} className={`${buttonClass} bg-slate-800 text-slate-200`}>Cancel</button>
            </div>
          )}
          {form === 'check' && (
            <div className="space-y-2">
              <p className="text-slate-400">Enter what the bank statement shows for this deposit. Dropped off: {moneyText(d.total)}.</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-slate-400">Bank credited
                  <input type="number" min="0" step="0.01" value={bankAmount} onChange={e => setBankAmount(e.target.value)} className={`block mt-1 w-28 ${inputClass}`} />
                </label>
                <label className="text-slate-400 flex-1 min-w-[10rem]">Note (optional)
                  <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} placeholder="e.g. one check returned" className={`block mt-1 w-full ${inputClass}`} />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy || bankAmount === ''}
                  onClick={() => run(() => checkDepositAgainstBank(d.bankdepositid, { bankAmount: Number(bankAmount), notes }), `${label} checked against the bank.`)}
                  className={`${buttonClass} bg-emerald-600 hover:bg-emerald-500 text-white`}>Save bank check</button>
                <button type="button" disabled={busy} onClick={() => setForm(null)} className={`${buttonClass} bg-slate-800 text-slate-200`}>Cancel</button>
              </div>
            </div>
          )}
          {form === 'void' && (
            <div className="space-y-2">
              <p className="text-slate-400">Voiding puts this money back on hand with whoever held it. The deposit stays on record as voided.</p>
              <input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Reason (required)" className={`w-full ${inputClass}`} />
              <div className="flex gap-2">
                <button type="button" disabled={busy || !reason.trim()}
                  onClick={() => run(() => voidBankDeposit(d.bankdepositid, reason), `${label} voided; its money is back on hand.`)}
                  className={`${buttonClass} bg-red-600 hover:bg-red-500 text-white`}>Void deposit</button>
                <button type="button" disabled={busy} onClick={() => setForm(null)} className={`${buttonClass} bg-slate-800 text-slate-200`}>Cancel</button>
              </div>
            </div>
          )}

          {form === null && (
            <div className="flex flex-wrap gap-2">
              {canEditSlip && <button type="button" onClick={() => setForm('slip')} className={`${buttonClass} bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700`}>{d.slipnumber ? 'Change slip #' : 'Add slip #'}</button>}
              {isAdmin && status === 'waiting' && <button type="button" onClick={() => setForm('check')} className={`${buttonClass} bg-emerald-600 hover:bg-emerald-500 text-white`}>Check against bank</button>}
              {isAdmin && d.verifiedon && !d.voidedon && (
                <button type="button" disabled={busy}
                  onClick={async () => { if (await askConfirm({ title: 'Clear the bank check on this deposit?', confirmLabel: 'Clear Bank Check', danger: true })) run(() => checkDepositAgainstBank(d.bankdepositid, { clear: true }), `${label}: bank check cleared.`); }}
                  className={`${buttonClass} bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700`}>Clear bank check</button>
              )}
              {isAdmin && status === 'waiting' && <button type="button" onClick={() => setForm('void')} className={`${buttonClass} bg-slate-800 hover:bg-red-900/60 text-red-300 border border-slate-700`}>Void</button>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
