import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getMoneyHistory } from '../../api';
import type { MoneyHistory } from '../../api';
import { errorMessage } from '../../utils/errors';
import { moneyText } from '../../utils/moneyOnHand';

const DOT: Record<string, string> = {
  collected: 'bg-blue-400', offered: 'bg-amber-400', accepted: 'bg-emerald-400', declined: 'bg-slate-400',
  cancelled: 'bg-slate-400', deposited: 'bg-emerald-400', checked: 'bg-sky-400', voided: 'bg-red-400', 'checked-off': 'bg-emerald-400',
};

// Where one item of money has been, oldest first: collected, each hand-off, the bank deposit and its bank check
export default function HistoryDialog({ itemKey, onClose }: { itemKey: string; onClose: () => void }) {
  const [history, setHistory] = useState<{ key: string; data?: MoneyHistory; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMoneyHistory(itemKey)
      .then(data => { if (!cancelled) setHistory({ key: itemKey, data }); })
      .catch(err => { if (!cancelled) setHistory({ key: itemKey, error: errorMessage(err, 'Failed to load where this money has been.') }); });
    return () => { cancelled = true; };
  }, [itemKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = history?.key === itemKey ? history : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Where this money has been"
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold text-white">Where this money has been</h3>
            {shown?.data && (
              <p className="text-xs text-slate-400 mt-0.5">
                {shown.data.label} · {moneyText(shown.data.amount)}
                {shown.data.holder ? ` · held by ${shown.data.holder.name}` : ' · not on hand'}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        {!shown && <div className="animate-pulse h-24 rounded-lg bg-slate-800/60" aria-label="Loading" />}
        {shown?.error && <p className="text-xs text-red-400">{shown.error}</p>}
        {shown?.data && (
          <ol className="relative border-l border-slate-700 ml-1.5 space-y-4">
            {shown.data.events.map((e, i) => (
              <li key={i} className="ml-4">
                <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${DOT[e.kind] || 'bg-slate-400'}`} />
                <p className="text-[11px] text-slate-500">{e.at ? new Date(e.at).toLocaleString() : ''}</p>
                <p className="text-sm text-slate-200">{e.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
