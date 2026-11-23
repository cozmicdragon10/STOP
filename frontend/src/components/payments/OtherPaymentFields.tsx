import { otherTypesFor } from '../../utils/paymentMethods';
import { useUserRole } from '../../hooks/useUserRole';
import { checkBlocked, checkBlockedText, otherTypesForClient } from '../../utils/checkBlock';

interface Props {
  subtype: string;
  reference: string;
  onChange: (patch: { subtype?: string; reference?: string }) => void;
  disabled?: boolean;
  // The client paying: Check is left out when a Business Administrator blocked their check payments
  client?: { checkpaymentsblocked?: boolean | null; checkblockreason?: string | null } | null;
  // Input styling from the form it's in
  inputClass?: string;
}

// The Other payment's kind (Check, Money Order, ...; Direct Deposit, Tribal and DHS for Business Administrators only)
// and an optional reference number. Shown under the payment method buttons when Other is picked. Check isn't offered to
// a client whose check payments are blocked (utils/checkBlock.ts); the server refuses it too.
export default function OtherPaymentFields({ subtype, reference, onChange, disabled = false, client = null, inputClass = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm' }: Props) {
  const types = otherTypesForClient(otherTypesFor(useUserRole()), client);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
      {checkBlocked(client) && <p className="sm:col-span-2 text-amber-400">{checkBlockedText(client)}</p>}
      <label className="flex flex-col gap-1">
        <span>Other payment type *</span>
        <select value={subtype} onChange={e => onChange({ subtype: e.target.value })} disabled={disabled}
          className={`${inputClass} ${subtype ? '' : 'border-amber-500'} disabled:opacity-50`}>
          <option value="">-- Choose --</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span>Reference # <span className="text-slate-500">(optional)</span></span>
        <input type="text" maxLength={100} value={reference} onChange={e => onChange({ reference: e.target.value })} disabled={disabled}
          placeholder="Check #, money order #, ..." className={`${inputClass} disabled:opacity-50`} />
      </label>
    </div>
  );
}
