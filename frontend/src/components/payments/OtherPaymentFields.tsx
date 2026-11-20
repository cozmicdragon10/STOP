import { otherTypesFor } from '../../utils/paymentMethods';
import { useUserRole } from '../../hooks/useUserRole';

interface Props {
  subtype: string;
  reference: string;
  onChange: (patch: { subtype?: string; reference?: string }) => void;
  disabled?: boolean;
  // Input styling from the form it's in
  inputClass?: string;
}

// The Other payment's kind (Check, Money Order, ...; Direct Deposit, Tribal and DHS for Business Administrators only)
// and an optional reference number. Shown under the payment method buttons when Other is picked.
export default function OtherPaymentFields({ subtype, reference, onChange, disabled = false, inputClass = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm' }: Props) {
  const types = otherTypesFor(useUserRole());
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
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
