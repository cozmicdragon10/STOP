import { useState } from 'react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { validateSession } from '../../hooks/useGroupCheckIn';
import type { ClientRecord, GroupCheckInState, GroupRecord, SessionEntry } from '../../hooks/useGroupCheckIn';
import { formatBalance, toDisplayBalance } from '../../utils/balance';
import ClientPaymentDialog from '../payments/ClientPaymentDialog';

interface Props {
  group: GroupRecord;
  wf: GroupCheckInState;
  createdBy: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onSaved: () => void;
}

const inputClass = 'bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm w-full';

function ReviewRow({ entry, balance, onChange, onRemove, onMakePayment }: {
  entry: SessionEntry;
  balance: number;
  onChange: (patch: Partial<Omit<SessionEntry, 'client'>>) => void;
  onRemove: () => void;
  onMakePayment: () => void;
}) {
  const { client } = entry;
  // What the account will read once the group closes: fee charged, cash payment from check-in recorded.
  // A card payment from check-in is already in the balance, so it is not subtracted again.
  const afterClose = balance + entry.fee - entry.payment;

  return (
    <article className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{client.lastname}, {client.firstname}</p>
          <p className="text-xs text-slate-400">DOC # {client.docnumber || '—'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onMakePayment}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
          >
            Make Payment
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-slate-400 hover:text-red-400 p-1 rounded"
            aria-label={`Remove ${client.firstname} ${client.lastname} from session`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs space-y-1.5">
        <div className="flex justify-between">
          <span className="text-slate-400">Current balance</span>
          <span className={toDisplayBalance(balance) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatBalance(balance)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Group fee applied</span>
          <span className={entry.fee > 0 ? 'text-red-400' : 'text-slate-400'}>{formatBalance(entry.fee)}</span>
        </div>
        {entry.payment > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-400">Paid at check-in ({entry.paymentMethod})</span>
            <span className="text-emerald-400">{formatBalance(-entry.payment)}</span>
          </div>
        )}
        {entry.cardPaid > 0 && (
          <p className="text-slate-500">Includes ${entry.cardPaid.toFixed(2)} card payment processed at check-in.</p>
        )}
        <div className="flex justify-between border-t border-slate-800 pt-1.5">
          <span className="font-semibold text-slate-300">Balance after group closes</span>
          <span className={`font-bold ${toDisplayBalance(afterClose) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(afterClose)}</span>
        </div>
      </div>

      <label className="block">
        <span className="text-xs text-slate-400 uppercase font-semibold tracking-wide">Notes</span>
        <textarea
          rows={2}
          value={entry.comments}
          onChange={e => onChange({ comments: e.target.value })}
          placeholder="Participation notes, attendance flags, late arrival..."
          className={`${inputClass} mt-1 resize-y`}
        />
      </label>
    </article>
  );
}

export default function ReviewStep({ group, wf, createdBy, onSuccess, onError, onSaved }: Props) {
  const problem = validateSession(wf.session);
  const [paymentClient, setPaymentClient] = useState<ClientRecord | null>(null);
  // Balances after a payment taken on this screen. Session entries keep the balance they were checked in with.
  const [updatedBalances, setUpdatedBalances] = useState<Record<number, number>>({});
  const paymentEntry = paymentClient ? wf.session.find(e => e.client.clientid === paymentClient.clientid) : undefined;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5 shadow-xl">
      <header className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h3 className="font-semibold text-white">Review & Comments: {group.groupname}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {wf.session.length} client(s) checked in this session
          </p>
        </div>
        <button type="button" onClick={wf.backToCheckIn} disabled={wf.submitting}
          className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-40">
          <ArrowLeft size={14} /> Back to Check-In
        </button>
      </header>

      <div className="space-y-4">
        {wf.session.map(entry => (
          <ReviewRow
            key={entry.client.clientid}
            entry={entry}
            balance={updatedBalances[entry.client.clientid] ?? entry.balance}
            onChange={patch => wf.updateEntry(entry.client.clientid, patch)}
            onRemove={() => wf.removeEntry(entry.client.clientid)}
            onMakePayment={() => setPaymentClient(entry.client)}
          />
        ))}
      </div>

      {problem && (
        <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">{problem}</p>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
        <button
          type="button"
          onClick={wf.finishCheckIn}
          disabled={wf.submitting || wf.session.length === 0}
          className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-semibold px-6 py-2.5 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save for Later
        </button>
        <button
          type="button"
          onClick={wf.submitSession}
          disabled={wf.submitting || problem !== null}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save size={14} /> {wf.submitting ? 'Saving...' : 'Close Group & Save Attendance'}
        </button>
      </div>

      {paymentClient && (
        <ClientPaymentDialog
          client={paymentClient}
          balance={updatedBalances[paymentClient.clientid] ?? paymentEntry?.balance ?? 0}
          checkIn={{
            fee: paymentEntry?.fee ?? 0,
            payment: paymentEntry?.payment ?? 0,
            paymentMethod: paymentEntry?.paymentMethod ?? 'Cash',
            cardPaid: paymentEntry?.cardPaid ?? 0,
          }}
          createdBy={createdBy}
          onClose={() => setPaymentClient(null)}
          onSuccess={onSuccess}
          onError={onError}
          onProcessed={newBalance => {
            setUpdatedBalances(prev => ({ ...prev, [paymentClient.clientid]: newBalance }));
            onSaved();
          }}
        />
      )}
    </section>
  );
}
