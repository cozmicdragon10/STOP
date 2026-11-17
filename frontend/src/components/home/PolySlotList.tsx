import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { PolygraphSlot } from '../../api';
import { formatDisplayTime } from '../../utils/dates';

interface Props {
  title: string;
  // Right of the title, e.g. "4 booked · 0 open"
  summary?: string;
  slots: PolygraphSlot[];
  // Shown when there are no slots
  empty: string;
  // An examiner's email shown as their name; leave out to hide the examiner (a Polygrapher's own list)
  examinerName?: (email: string) => string;
  // Show each slot's date before its time (lists that span days)
  showDate?: boolean;
  // Privacy view: booked clients' names are left out
  privacy: boolean;
  // The title opens the Polygraphs tab
  onOpen: () => void;
  // A row opens that slot; leave out for rows that can't be clicked
  onOpenSlot?: (slotId: number) => void;
  // Overrides the status badge, e.g. "Needs result"
  badge?: (slot: PolygraphSlot) => ReactNode;
  // Show at most this many, with a link (to onOpen) for the rest
  limit?: number;
}

const SLOT_STYLE: Record<string, string> = {
  Open: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  Assigned: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Closed: 'bg-slate-800 text-slate-400 border-slate-700',
};

const shortDate = (date: string) => {
  const [y, m, d] = String(date || '').split('T')[0].split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
};

// A card listing polygraph slots on the Home page (the office's day, or a Polygrapher's own)
export default function PolySlotList({ title, summary, slots, empty, examinerName, showDate = false, privacy, onOpen, onOpenSlot, badge, limit }: Props) {
  const shown = limit ? slots.slice(0, limit) : slots;
  const more = slots.length - shown.length;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <button type="button" onClick={onOpen} className="flex items-center gap-2 text-blue-400 hover:text-blue-300" title="Open Polygraphs">
          <ShieldAlert size={16} />
          <span className="font-semibold text-white">{title}</span>
        </button>
        {summary && <span className="text-xs text-slate-400 text-right">{summary}</span>}
      </div>
      {slots.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {shown.map(s => {
            const status = s.status || 'Open';
            const row = (
              <>
                <span className={`${showDate ? 'w-28' : 'w-20'} shrink-0 text-xs text-slate-400`}>
                  {showDate && <span className="block text-slate-300">{shortDate(s.date)}</span>}
                  {formatDisplayTime(s.time) || '—'}
                </span>
                <span className="min-w-0 flex-1">
                  {examinerName
                    ? <span className="text-slate-300">{s.polygrapher ? examinerName(s.polygrapher) : 'No examiner'}</span>
                    : <span className="text-slate-300">{s.location || 'No location'}</span>}
                  {examinerName && s.location && <span className="text-xs text-slate-500"> · {s.location}</span>}
                  {status === 'Assigned' && s.assignedClientName && !privacy && <span className="block text-xs text-slate-400">{s.assignedClientName}</span>}
                </span>
                <span className="shrink-0">
                  {badge?.(s) ?? (
                    <span className={`px-2 py-0.5 rounded-full border text-[0.625rem] font-semibold ${SLOT_STYLE[status] ?? SLOT_STYLE.Open}`}>
                      {status === 'Assigned' ? 'Booked' : status}
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={s.slotid}>
                {onOpenSlot ? (
                  <button type="button" onClick={() => onOpenSlot(s.slotid)} title="Open this slot"
                    className="w-full text-left py-2 flex items-baseline gap-3 text-sm hover:bg-slate-800/50 rounded px-1">
                    {row}
                  </button>
                ) : (
                  <div className="py-2 flex items-baseline gap-3 text-sm">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {more > 0 && (
        <button type="button" onClick={onOpen} className="mt-2 text-xs font-semibold text-blue-400 hover:text-blue-300">
          and {more} more · see them all
        </button>
      )}
    </div>
  );
}
