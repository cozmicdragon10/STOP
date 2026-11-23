import { useState } from 'react';
import { X } from 'lucide-react';
import ClientPicker from '../ClientPicker';
import type { ClientRecord, RemovalChoice, SessionEntry } from '../../hooks/useGroupCheckIn';
import { paymentMethodText } from '../../utils/paymentMethods';

type Choice = 'other' | 'own' | 'refund';

interface Props {
  entry: SessionEntry;
  // Every client, for "Apply to another client's account"
  clients: ClientRecord[];
  saving: boolean;
  onConfirm: (choice: RemovalChoice) => void;
  onCancel: () => void;
}

// Removing a client who paid at check-in. Cash or Other is recorded only when the group closes, so before the client
// leaves the sheet it goes on their account, on another client's (the usual case: the wrong client was checked in), or
// back to the client. A card payment is already on their account: it moves to the client who paid, or stays as a credit.
export default function RemovePaidClientDialog({ entry, clients, saving, onConfirm, onCancel }: Props) {
  const card = entry.payment <= 0 && entry.cardPaid > 0;
  const [choice, setChoice] = useState<Choice>('other');
  const [otherId, setOtherId] = useState('');
  const name = `${entry.client.lastname}, ${entry.client.firstname}`;
  const paid = card
    ? `$${entry.cardPaid.toFixed(2)} Credit Card`
    : `$${entry.payment.toFixed(2)} ${paymentMethodText(entry.paymentMethod, entry.paymentSubtype, entry.paymentReference)}`;
  const others = clients.filter(c => c.clientid !== entry.client.clientid);
  const otherClient = others.find(c => String(c.clientid) === otherId);
  const ready = choice !== 'other' || otherClient !== undefined;

  const confirm = () => {
    if (!ready || saving) return;
    if (choice === 'other') onConfirm({ kind: card ? 'move-card' : 'account', toClient: otherClient! });
    else if (card) onConfirm({ kind: 'keep-card' });
    else if (choice === 'own') onConfirm({ kind: 'account', toClient: entry.client });
    else onConfirm({ kind: 'refund' });
  };

  const option = (value: Choice, title: string, detail: string) => (
    <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${choice === value ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-950 hover:border-slate-600'}`}>
      <input type="radio" name="removal-choice" value={value} checked={choice === value} onChange={() => setChoice(value)} disabled={saving} className="mt-0.5 accent-blue-500" />
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="block text-xs text-slate-400 mt-0.5">{detail}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="remove-paid-title">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <header className="flex justify-between items-start gap-3 p-4 border-b border-slate-800">
          <div>
            <h3 id="remove-paid-title" className="font-semibold text-white">Remove {name}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              They paid <span className="font-semibold text-slate-200">{paid}</span> at check-in.{' '}
              {card
                ? 'The card was already charged and the payment is on their account. Choose where it belongs.'
                : 'It hasn\'t been recorded yet, so choose where the money goes before they come off the sheet.'}
            </p>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} className="text-slate-400 hover:text-white p-1 rounded" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="p-4 space-y-3 overflow-y-auto">
          {card
            ? option('other', 'Move to another client\'s account', 'The wrong client was checked in. The card payment moves to the client who paid; check them in and it shows as credit.')
            : option('other', 'Apply to another client\'s account', 'The wrong client was checked in. The payment goes on the right client\'s account now; check them in and it shows as credit.')}
          {choice === 'other' && (
            <div className="pl-7">
              <ClientPicker
                clients={others}
                value={otherId}
                onChange={setOtherId}
                placeholder="Search the client who paid..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
              />
            </div>
          )}
          {card
            ? option('own', `Keep on ${entry.client.firstname}'s account`, 'The payment stays on their account as a credit. To refund the card, a Business Administrator records the refund on their Financial Ledger.')
            : option('own', `Apply to ${entry.client.firstname}'s account`, 'Keep the money as a payment on their account (they leave without attending). Recorded now.')}
          {!card && option('refund', 'Refund', 'Hand the money back. Nothing is recorded.')}
        </div>

        <footer className="flex justify-end gap-3 p-4 border-t border-slate-800">
          <button type="button" onClick={onCancel} disabled={saving}
            className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-40">
            Keep on Sheet
          </button>
          <button type="button" onClick={confirm} disabled={!ready || saving}
            className="bg-red-600 hover:bg-red-500 text-white font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Saving...' : choice === 'refund' ? 'Refund & Remove' : choice === 'other' && card ? 'Move & Remove' : choice === 'own' && card ? 'Remove' : 'Apply & Remove'}
          </button>
        </footer>
      </div>
    </div>
  );
}
