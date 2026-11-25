import { useState } from 'react';
import { Ban } from 'lucide-react';
import { setClientCheckPayments, type CheckBlock } from '../../api';
import { useUnsavedForm } from '../../hooks/useUnsavedForm';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import { askConfirm } from '../../utils/confirm';

interface Props {
  client: {
    clientid: number;
    firstname: string;
    lastname: string;
    checkpaymentsblocked?: boolean | null;
    checkblockreason?: string | null;
    checkblockedby?: string | null;
    checkblockedon?: string | null;
  };
  // Only Business Administrators set or lift the block (the server checks the role too)
  isAdmin: boolean;
  onChanged: (clientId: number, changes: CheckBlock) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

// Check payments on the Ledger tab: everyone sees a block; Business Administrators can set or lift it (e.g. after a
// bounced check). While blocked, payment screens don't offer Check (utils/checkBlock.ts) and the server refuses it.
export default function CheckBlockPanel({ client, isAdmin, onChanged, onSuccess, onError }: Props) {
  const employeeLabel = useEmployeeLabel();
  // The reason being typed; null when the form is closed
  const [reason, setReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useUnsavedForm(!!reason?.trim());
  const name = `${client.firstname} ${client.lastname}`;

  const change = async (blocked: boolean, why: string) => {
    const clientid = client.clientid;
    setSaving(true);
    try {
      const saved = await setClientCheckPayments(clientid, blocked, why);
      onChanged(clientid, saved);
      setReason(null);
      onSuccess(blocked ? `Check payments blocked for ${name}.` : `Check payments allowed again for ${name}.`);
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Could not change check payments for this client.');
    } finally {
      setSaving(false);
    }
  };

  if (client.checkpaymentsblocked) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 text-sm text-amber-300 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold"><Ban size={14} className="inline mr-1.5 -mt-0.5" />Check payments blocked</p>
          {client.checkblockreason && <p className="text-xs text-amber-200/80 mt-0.5">{client.checkblockreason}</p>}
          <p className="text-xs text-amber-200/60 mt-0.5">
            {client.checkblockedby ? `Blocked by ${employeeLabel(client.checkblockedby)}` : 'Blocked'}
            {client.checkblockedon ? ` on ${new Date(client.checkblockedon).toLocaleDateString()}` : ''}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            disabled={saving}
            onClick={async () => { if (await askConfirm({ title: `Allow ${name} to pay by check again?`, confirmLabel: 'Allow Checks' })) change(false, ''); }}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-500/40 hover:bg-amber-500/10 disabled:opacity-50"
          >
            Allow Check Payments
          </button>
        )}
      </div>
    );
  }

  if (!isAdmin) return null;

  if (reason === null) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setReason('')} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-400">
          <Ban size={12} /> Block Check Payments
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (reason.trim()) change(true, reason.trim()); }}
      className="bg-slate-950 border border-amber-500/40 rounded-xl p-3 space-y-2"
    >
      <p className="text-xs font-semibold text-amber-300">Block check payments</p>
      <p className="text-xs text-slate-400">The client won't be able to pay by check on any payment screen until a Business Administrator allows checks again. Cash, card, money orders and cashier's checks are still taken. This is noted on the change log and case notes.</p>
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason, e.g. check #1042 for $180.00 returned by the bank"
        autoFocus
        required
        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setReason(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Cancel</button>
        <button type="submit" disabled={saving || !reason.trim()} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
          Block Check Payments
        </button>
      </div>
    </form>
  );
}
