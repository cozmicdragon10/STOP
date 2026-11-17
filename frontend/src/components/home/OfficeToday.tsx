import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, ShieldAlert } from 'lucide-react';
import { getGroupScheduleChanges } from '../../api';
import type { GroupScheduleChange, PolygraphSlot } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { formatDisplayTime } from '../../utils/dates';
import { meetingsOn, polySlotsOn, relativeDayName, shiftDay } from '../../utils/home';
import type { HomeGroup } from '../../utils/home';

interface Props {
  groups: HomeGroup[];
  polySlots: PolygraphSlot[];
  // An examiner's email shown as their name
  examinerName: (email: string) => string;
  // Privacy view: booked clients' names are left out
  privacy: boolean;
  onOpenAttendance: () => void;
  onOpenPolygraphs: () => void;
}

const STATUS_STYLE = {
  scheduled: 'text-slate-300',
  movedHere: 'text-blue-300',
  cancelled: 'text-slate-500 line-through',
  movedAway: 'text-slate-500 line-through',
} as const;

const SLOT_STYLE: Record<string, string> = {
  Open: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  Assigned: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Closed: 'bg-slate-800 text-slate-400 border-slate-700',
};

const DAY_BUTTON = 'p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700';

// Business Administrators, DEV and Office Admins: what is happening in the office on a day (today to start; earlier and
// later days can be picked), every counselor's groups and every examiner's polygraph slots, with the day's cancellations
// and reschedules applied. Groups are listed by their current weekly schedule, so a past day shows today's groups.
export default function OfficeToday({ groups, polySlots, examinerName, privacy, onOpenAttendance, onOpenPolygraphs }: Props) {
  const today = todayLocal();
  const [day, setDay] = useState(today);
  const month = day.slice(0, 7);
  // Each month's changes are loaded when a day in it is picked; a month's list is only used for that month
  const [changes, setChanges] = useState<{ month: string; list: GroupScheduleChange[] } | null>(null);
  const [changesError, setChangesError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getGroupScheduleChanges(month)
      .then(list => { if (!cancelled) { setChanges({ month, list }); setChangesError(''); } })
      .catch(() => { if (!cancelled) setChangesError('Cancellations and reschedules could not be loaded, so the list may not show them.'); });
    return () => { cancelled = true; };
  }, [month]);

  const meetings = meetingsOn(groups, changes?.month === month ? changes.list : [], day);
  const meetingCount = meetings.filter(m => m.status === 'scheduled' || m.status === 'movedHere').length;
  const polys = polySlotsOn(polySlots, day);
  const [y, m, d] = day.split('-').map(Number);
  const dayLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: y === Number(today.slice(0, 4)) ? undefined : 'numeric' });
  const relative = relativeDayName(day, today);
  const onWhen = day === today ? 'today' : 'on this day';

  return (
    <section>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <h3 className="text-xs uppercase tracking-wide text-slate-400 font-semibold mr-auto">
          {relative ? `${relative} · ` : ''}{dayLabel}
        </h3>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day" title="Previous day" className={DAY_BUTTON}>
            <ChevronLeft size={14} />
          </button>
          <input
            type="date"
            value={day}
            onChange={e => { if (e.target.value) setDay(e.target.value); }}
            aria-label="Pick a day"
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-xs [color-scheme:dark]"
          />
          <button type="button" onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day" title="Next day" className={DAY_BUTTON}>
            <ChevronRight size={14} />
          </button>
          {day !== today && (
            <button type="button" onClick={() => setDay(today)} className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold">
              Today
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <button type="button" onClick={onOpenAttendance} className="flex items-center gap-2 text-blue-400 hover:text-blue-300" title="Open Attendance & Sign-In">
              <Layers size={16} />
              <span className="font-semibold text-white">Groups Meeting</span>
            </button>
            <span className="text-xs text-slate-400">{meetingCount} meeting{meetingCount === 1 ? '' : 's'}</span>
          </div>
          {changesError && <p className="text-xs text-amber-400 mb-2">{changesError}</p>}
          {meetings.length === 0 ? (
            <p className="text-sm text-slate-500">No groups meet {onWhen}.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {meetings.map(m => (
                <li key={m.key} className="py-2 flex items-baseline gap-3 text-sm">
                  <span className="w-20 shrink-0 text-xs text-slate-400">{m.time || '—'}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`font-medium ${STATUS_STYLE[m.status]}`}>{m.groupname}</span>
                    {m.counselor && <span className="text-xs text-slate-500"> · {m.counselor}</span>}
                    {m.note && <span className={`block text-xs ${m.status === 'movedHere' ? 'text-blue-400' : 'text-amber-400'}`}>{m.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <button type="button" onClick={onOpenPolygraphs} className="flex items-center gap-2 text-blue-400 hover:text-blue-300" title="Open Polygraphs">
              <ShieldAlert size={16} />
              <span className="font-semibold text-white">Polygraphs</span>
            </button>
            <span className="text-xs text-slate-400">{polys.assigned} booked · {polys.open} open{polys.closed ? ` · ${polys.closed} closed` : ''}</span>
          </div>
          {polys.list.length === 0 ? (
            <p className="text-sm text-slate-500">No polygraph slots {onWhen}.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {polys.list.map(s => {
                const status = s.status || 'Open';
                return (
                  <li key={s.slotid} className="py-2 flex items-baseline gap-3 text-sm">
                    <span className="w-20 shrink-0 text-xs text-slate-400">{formatDisplayTime(s.time) || '—'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="text-slate-300">{s.polygrapher ? examinerName(s.polygrapher) : 'No examiner'}</span>
                      {s.location && <span className="text-xs text-slate-500"> · {s.location}</span>}
                      {status === 'Assigned' && s.assignedClientName && !privacy && <span className="block text-xs text-slate-400">{s.assignedClientName}</span>}
                    </span>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[0.625rem] font-semibold ${SLOT_STYLE[status] ?? SLOT_STYLE.Open}`}>
                      {status === 'Assigned' ? 'Booked' : status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
