import { useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { lookupTransaction } from '../../api';
import type { TransactionLookup as Found, TransactionRow } from '../../api';
import { formatBalance } from '../../utils/balance';
import { idText } from '../../utils/clients';

const money = (n: string | number | null) => `$${Number(n || 0).toFixed(2)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
// Attendance dates are plain dates (no time), shown as MM/DD/YYYY
const day = (iso: string | null) => {
  const [y, m, d] = (iso || '').slice(0, 10).split('-');
  return y && m && d ? `${m}/${d}/${y}` : '';
};
const describe = (t: TransactionRow) => `${t.type}${t.feetype ? ` · ${t.feetype}` : ''}${t.paymentmethod ? ` · ${t.paymentmethod}` : ''}`;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.6875rem] text-slate-500">{label}</p>
      <p className="text-white font-medium break-words">{value || '—'}</p>
    </div>
  );
}

// Finds one payment, fee, or other ledger row by the ID number printed at the bottom of its receipt
export default function TransactionLookup({ onOpen }: { onOpen: (clientId: number, transactionId: number) => void }) {
  const [id, setId] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const lookUp = async (n: number) => {
    setFound(null);
    if (!Number.isInteger(n) || n <= 0) { setError('Enter the transaction ID number from the receipt.'); return; }
    setLoading(true);
    setError('');
    try {
      setFound(await lookupTransaction(n));
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to look up the transaction.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-4 lg:col-span-2">
      <div className="border-b border-slate-800 pb-3">
        <h2 className="text-lg font-bold text-white">Transaction Lookup</h2>
        <p className="text-xs text-slate-400 mt-0.5">Find a payment or fee by the ID number printed next to "Thank you." at the bottom of a payment receipt.</p>
      </div>

      <form onSubmit={e => { e.preventDefault(); lookUp(Number(id.trim().replace(/^#/, ''))); }} className="flex flex-wrap items-center gap-2">
        <input type="text" inputMode="numeric" value={id} onChange={e => setId(e.target.value)} placeholder="Transaction ID" aria-label="Transaction ID" className="bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm w-44" />
        <button type="submit" disabled={loading || !id.trim()} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded text-sm inline-flex items-center gap-1.5">
          <Search size={14} /> {loading ? 'Looking up...' : 'Look Up'}
        </button>
      </form>

      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

      {found && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-sm space-y-4">
          <div className="flex flex-wrap justify-between items-baseline gap-2">
            <p className="text-white font-bold">Transaction {found.transactionid}</p>
            <div className="flex items-center gap-3">
              <p className="text-slate-400 text-xs">{when(found.date)}</p>
              <button type="button" onClick={() => onOpen(found.client, found.transactionid)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3 py-1.5 rounded text-xs inline-flex items-center gap-1.5">
                <ExternalLink size={13} /> Open in Client Account
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Client" value={found.lastname ? `${found.lastname}, ${found.firstname ?? ''}` : `Client ID ${found.client}`} />
            <Field label="ID #" value={idText(found)} />
            <Field label="Program" value={found.programtype || ''} />
            <Field label="Client ID" value={String(found.client)} />
            <Field label="Type" value={found.type} />
            <Field label="Applied to" value={found.feetype || ''} />
            <Field label="Amount" value={money(found.amount)} />
            <Field label="Payment method" value={found.paymentmethod || ''} />
            <Field label="Balance after" value={found.finalbalance === null ? '' : formatBalance(found.finalbalance)} />
            <Field label="Entered by" value={found.enteredby || ''} />
            <Field label="Dispute status" value={found.disputestatus || ''} />
            <Field label="Attendance" value={found.attendanceid ? `${found.attendancetype || 'Session'}${found.groupname ? `: ${found.groupname}` : ''} on ${day(found.attendancedate)} (ID ${found.attendanceid})` : ''} />
          </div>
          {found.comments && <Field label="Comments" value={found.comments} />}
          {found.adjustedon && (
            <Field label="Adjusted" value={`From ${money(found.originalamount)} on ${when(found.adjustedon)}${found.adjustedby ? ` by ${found.adjustedby}` : ''}${found.adjustmentreason ? `: ${found.adjustmentreason}` : ''}`} />
          )}
          {found.related.length > 0 && (
            <div>
              <p className="text-[0.6875rem] text-slate-500 mb-1">Related transactions</p>
              <div className="space-y-1">
                {found.related.map(t => (
                  <button key={t.transactionid} type="button" onClick={() => { setId(String(t.transactionid)); lookUp(t.transactionid); }}
                    className="w-full text-left bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded px-3 py-1.5 text-xs flex flex-wrap justify-between gap-2">
                    <span className="text-white"><span className="text-blue-400 font-semibold">{t.transactionid}</span> {describe(t)}</span>
                    <span className="text-slate-400">{money(t.amount)} · {when(t.date)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
