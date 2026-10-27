import { useState } from 'react';
import { createPolygraphSlot } from '../../api';
import { formatDisplayTime, getDefaultPolyTime, getLocalDateString, getLocalTimeString } from '../../utils/dates';

interface Employee {
  employeeemail: string;
  displayname: string | null;
  role: string;
  active?: boolean | null;
}

interface Props {
  role: string;
  employees: Employee[];
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  // Called after a slot is saved so the schedule can reload and show it
  onCreated: () => void;
}

const SLOT_TYPES: [string, string][] = [
  ['Maintenance', 'Maintenance'],
  ['Instant', 'Instant Poly'],
  ['Sexual History', 'Sexual History'],
  ['Specific', 'Specific Issue'],
  ['Monitoring', 'Monitoring'],
];

// Poly Admin: creates one appointment slot. Business Administrators and Polygraphers only.
export default function PolySlotForm({ role, employees, onSuccess, onError, onCreated }: Props) {
  const [polyLocation, setPolyLocation] = useState('Oklahoma City Office');
  const [polyAddress, setPolyAddress] = useState('123 Main St, OKC');
  const [polyDate, setPolyDate] = useState(() => getLocalDateString());
  const [polyTime, setPolyTime] = useState(() => getDefaultPolyTime());
  const [polyExaminer, setPolyExaminer] = useState('jvance@chandlercbt.com');
  const [polyType, setPolyType] = useState('Maintenance');
  const [saving, setSaving] = useState(false);

  const canCreate = role === 'Business Administrator' || role === 'Polygrapher';
  const activePolygraphers = employees.filter(e => e.role === 'Polygrapher' && e.active !== false);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) {
      onError('Only Business Administrators and Polygraphers can create appointment slots.');
      return;
    }
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const currentTimeStr = getLocalTimeString(now);

    if (!polyDate) return onError('Please select an appointment date.');
    if (!polyTime) return onError('Please select an appointment time.');
    if (polyDate < todayStr) return onError(`Appointment date cannot be in the past. Please select today (${todayStr}) or a future date.`);
    if (polyDate === todayStr && polyTime <= currentTimeStr) return onError(`Appointment time must be in the future (after ${formatDisplayTime(currentTimeStr)}).`);
    if (!polyExaminer) return onError('Please select an examiner for the appointment slot.');

    setSaving(true);
    onError('');
    try {
      await createPolygraphSlot({
        location: polyLocation,
        address: polyAddress,
        date: polyDate,
        time: polyTime,
        polygrapher: polyExaminer,
        type: polyType,
        comments: 'Scheduled Slot',
        slots: 1
      });
      onSuccess('Polygraph appointment slot created successfully!');
      onCreated();
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Failed to create slot.');
    } finally {
      setSaving(false);
    }
  };

  if (!canCreate) {
    return (
      <p className="text-xs text-slate-400 italic bg-slate-950 border border-slate-700 rounded-lg p-3">
        Only Business Administrators and Polygraphers can create appointment slots.
      </p>
    );
  }

  const today = getLocalDateString();
  return (
    <form onSubmit={handleCreateSlot} className="space-y-4 max-w-2xl">
      <h3 className="text-sm font-semibold text-blue-400">Create Single Appointment Slot</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Office Location</label>
          <input type="text" value={polyLocation} onChange={(e) => setPolyLocation(e.target.value)} placeholder="Location" className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Address</label>
          <input type="text" value={polyAddress} onChange={(e) => setPolyAddress(e.target.value)} placeholder="Address" className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Date</label>
          <input
            type="date"
            min={today}
            value={polyDate}
            onChange={(e) => {
              const newDate = e.target.value;
              setPolyDate(newDate);
              const curTime = getLocalTimeString();
              if (newDate === getLocalDateString() && polyTime && polyTime < curTime) {
                setPolyTime(curTime);
              }
            }}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm [color-scheme:dark]"
            required
          />
          <span className="text-[10px] text-slate-500 mt-1 block">Min date: Today ({today})</span>
        </div>
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Time</label>
          <input
            type="time"
            min={polyDate === today ? getLocalTimeString() : undefined}
            value={polyTime}
            onChange={(e) => setPolyTime(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm [color-scheme:dark]"
            required
          />
          <span className="text-[10px] text-slate-500 mt-1 block">
            {polyDate === today
              ? `Min time: ${formatDisplayTime(getLocalTimeString())} (active time)`
              : 'Future date: any time'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Examiner</label>
          <select
            value={polyExaminer}
            onChange={(e) => setPolyExaminer(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
            required
          >
            <option value="">-- Choose Examiner --</option>
            {activePolygraphers.map(e => (
              <option key={e.employeeemail} value={e.employeeemail}>
                {e.displayname} ({e.employeeemail})
              </option>
            ))}
          </select>
          {activePolygraphers.length === 0 && (
            <p className="text-xs text-amber-400 mt-1">No active polygraphers. Add or reactivate one under Admin.</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Slot Type</label>
          <select value={polyType} onChange={(e) => setPolyType(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
            {SLOT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
        {saving ? 'Creating...' : 'Create Appointment Slot'}
      </button>
    </form>
  );
}
