import { RotateCcw, Trash2 } from 'lucide-react';
import ClientPicker from '../ClientPicker';
import { formatDisplayTime } from '../../utils/dates';

export interface ScheduleSlot {
  slotid: number;
  status?: string | null;
  location?: string | null;
  address?: string | null;
  date: string;
  time?: string;
  polygrapher?: string | null;
  type?: string | null;
  assignedClientName?: string | null;
}

interface PickerClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
}

// The client, poly type, and comment picked on each open slot's card (kept by App, since scheduling from a
// client's account fills the same choices)
export interface SlotChoices {
  clientOf: (slotId: number) => string;
  typeOf: (slotId: number) => string;
  commentOf: (slotId: number) => string;
  setClient: (slotId: number, clientId: string) => void;
  setType: (slotId: number, type: string) => void;
  setComment: (slotId: number, comment: string) => void;
}

interface Props {
  // Slots that pass the Polygraph tab's filters, in the chosen order
  slots: ScheduleSlot[];
  filtersActive: boolean;
  role: string;
  // Clients who can be booked: one scheduled polygraph per client, so those already booked are left out
  assignableClients: PickerClient[];
  // Slot opened from a client's account, outlined for a few seconds
  highlightedSlotId: number | null;
  examinerName: (email: string) => string;
  choices: SlotChoices;
  onAssign: (slotId: number) => void;
  onCancelReservation: (slotId: number) => void;
  onDelete: (slotId: number) => void;
}

const POLY_TYPES: [string, string][] = [
  ['Instant', 'Instant Poly'],
  ['Maintenance', 'Maintenance'],
  ['Sexual History', 'Sexual History'],
  ['Specific', 'Specific Issue'],
  ['Monitoring', 'Monitoring'],
];

// Poly Schedule: every slot as a card. Business Administrators assign clients to open slots and delete open or
// closed ones; any assigned reservation can be cancelled.
export default function PolySchedule({ slots, filtersActive, role, assignableClients, highlightedSlotId, examinerName, choices, onAssign, onCancelReservation, onDelete }: Props) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-blue-400">Available Polygraph Slots & Client Assignment</h3>
      {slots.length === 0 ? (
        <p className="text-xs text-slate-500 italic">{filtersActive ? 'No slots match these filters.' : 'No available slots scheduled.'}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {slots.map(slot => (
            <div key={slot.slotid} id={`poly-slot-${slot.slotid}`} className={`bg-slate-950 border ${slot.status === 'Assigned' ? 'border-emerald-500/40 bg-emerald-950/10' : 'border-slate-800'} ${highlightedSlotId === slot.slotid ? 'ring-2 ring-blue-500' : ''} px-4 py-3 rounded-xl text-sm space-y-2 transition`}>
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white">{slot.location}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(slot.date).toLocaleDateString()} @ {formatDisplayTime(slot.time)}
                    <span className="text-slate-600"> · </span>{slot.address || 'Address not set'}
                    <span className="text-slate-600"> · </span>Examiner: {examinerName(slot.polygrapher || '')}
                  </p>
                </div>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded ${slot.status === 'Assigned' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : slot.status === 'Closed' ? 'bg-slate-800 text-slate-400 border border-slate-700' : 'bg-blue-500/10 text-blue-400'}`}>
                  {slot.status === 'Assigned' ? 'Assigned' : slot.status === 'Closed' ? 'Closed' : '1 Open Slot'}
                </span>
              </div>

              {slot.status === 'Assigned' ? (
                <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300 font-medium">Assigned Client: <strong className="text-emerald-400">{slot.assignedClientName}</strong></span>
                    <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded">{slot.type}</span>
                  </div>
                  <button
                    onClick={() => onCancelReservation(slot.slotid)}
                    className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 px-3 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition">
                    <RotateCcw size={13} /> Cancel Reservation & Reopen
                  </button>
                </div>
              ) : slot.status === 'Closed' ? (
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-400 italic">Reservation cancelled after the appointment time. This slot was not reopened.</p>
                  {role === 'Business Administrator' && (
                    <button
                      onClick={() => onDelete(slot.slotid)}
                      title="Delete closed slot"
                      className="bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 px-3 py-2 rounded text-xs font-semibold flex items-center justify-center gap-1 transition">
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              ) : role === 'Business Administrator' ? (
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-xs text-slate-400 uppercase mb-1">Assign Client</label>
                      <ClientPicker
                        clients={assignableClients}
                        value={choices.clientOf(slot.slotid)}
                        onChange={(id) => choices.setClient(slot.slotid, id)}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs placeholder-slate-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 uppercase mb-1">Poly Type</label>
                      <select
                        value={choices.typeOf(slot.slotid)}
                        onChange={(e) => choices.setType(slot.slotid, e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs">
                        {POLY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs text-slate-400 uppercase mb-1">Comment <span className="normal-case text-slate-500">(optional)</span></label>
                      <input
                        type="text"
                        value={choices.commentOf(slot.slotid)}
                        onChange={(e) => choices.setComment(slot.slotid, e.target.value)}
                        placeholder="Added to the client's case note when assigned..."
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => onAssign(slot.slotid)}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-semibold">
                      Confirm & Assign Slot
                    </button>
                    <button
                      onClick={() => onDelete(slot.slotid)}
                      title="Delete open slot"
                      className="bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 px-3 py-1.5 rounded text-xs font-semibold flex items-center justify-center gap-1 transition">
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              ) : (
                <p className="pt-3 text-xs text-slate-400 italic">Only Business Administrators can assign polygraph slots to clients.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
