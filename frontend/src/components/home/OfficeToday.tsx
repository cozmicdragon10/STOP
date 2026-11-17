import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { getGroupScheduleChanges } from '../../api';
import type { GroupScheduleChange, PolygraphSlot } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { meetingsOn, polySlotsOn } from '../../utils/home';
import type { HomeGroup } from '../../utils/home';
import DayPicker from './DayPicker';
import PolySlotList from './PolySlotList';

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
  const onWhen = day === today ? 'today' : 'on this day';

  return (
    <section>
      <DayPicker day={day} today={today} onChange={setDay} />
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

        <PolySlotList
          title="Polygraphs"
          summary={`${polys.assigned} booked · ${polys.open} open${polys.closed ? ` · ${polys.closed} closed` : ''}`}
          slots={polys.list}
          empty={`No polygraph slots ${onWhen}.`}
          examinerName={examinerName}
          privacy={privacy}
          onOpen={onOpenPolygraphs}
        />
      </div>
    </section>
  );
}
