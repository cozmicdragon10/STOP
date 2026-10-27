// Card payment fields shared by the Account-Only Payment screen and the check-in details dialog.
// Card number, expiration, and CVV are collected by PayPal's secure fields, so they are never stored here.
import type { CardBilling } from './cardBilling';

interface Props {
  value: CardBilling;
  onChange: (next: CardBilling) => void;
}

export default function CardPaymentFields({ value, onChange }: Props) {
  const set = (patch: Partial<CardBilling>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4 border border-slate-800 rounded-lg p-4 bg-slate-950/50">
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Card Details</p>
        <div className="border border-dashed border-slate-700 rounded-lg p-3 text-xs text-slate-500 space-y-2">
          <p>Card number, expiration, and security code are entered in PayPal's secure fields. They are not stored in this system.</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-900 border border-slate-800 rounded p-2 text-slate-600">Card number</div>
            <div className="bg-slate-900 border border-slate-800 rounded p-2 text-slate-600">MM / YY</div>
            <div className="bg-slate-900 border border-slate-800 rounded p-2 text-slate-600">CVV</div>
          </div>
          <p className="text-slate-500">Available once PayPal is connected.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Cardholder Name</label>
          <input type="text" value={value.cardholderName} onChange={(e) => set({ cardholderName: e.target.value })} placeholder="Name as shown on card" className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Receipt Email <span className="normal-case font-normal text-slate-500">(optional)</span></label>
          <input type="email" value={value.receiptEmail} onChange={(e) => set({ receiptEmail: e.target.value })} placeholder="name@example.com" className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Billing Street Address</label>
          <input type="text" value={value.street} onChange={(e) => set({ street: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">City</label>
          <input type="text" value={value.city} onChange={(e) => set({ city: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-1">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">State</label>
            <input type="text" maxLength={2} value={value.state} onChange={(e) => set({ state: e.target.value.toUpperCase() })} placeholder="OK" className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">ZIP</label>
            <input type="text" maxLength={10} value={value.zip} onChange={(e) => set({ zip: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
          </div>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Country</label>
          <select value={value.country} onChange={(e) => set({ country: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
            <option value="US">United States</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-500">Card processing is not connected yet, so this payment is recorded without charging the card.</p>
    </div>
  );
}
