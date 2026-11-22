import { CalendarClock, CalendarX } from 'lucide-react';
import { TONE_CHIP } from '../../utils/calendar';
import { phaseAttendanceNote, type UpcomingItem } from '../../utils/clientCalendar';
import { KindIcon } from '../calendar/CalendarKey';

interface Props {
  items: UpcomingItem[];
  today: string;
  phase: string | null;
  // Shown only when the client has a group (a Phase 2/3/4 client doesn't come every week)
  inGroup: boolean;
  onOpenCalendar: () => void;
}

// "Today", "Tomorrow", else "Thu, Dec 3"
const dayText = (day: string, today: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  const days = Math.round((date.getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// The top of a client's Attendance list: what's next for them (next group meeting, booked assessments and polygraphs,
// and group meetings cancelled or moved soon), so "when's my next...?" is answered without opening the calendar
export default function ClientComingUp({ items, today, phase, inGroup, onOpenCalendar }: Props) {
  const phaseNote = inGroup ? phaseAttendanceNote(phase) : '';
  return (
    <section aria-label="Coming up" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock size={15} className="text-blue-400 shrink-0" />
        <h4 className="text-sm font-semibold text-white">Coming Up</h4>
        <button type="button" onClick={onOpenCalendar} className="ml-auto text-xs text-blue-400 hover:text-blue-300 font-medium">See the calendar</button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing scheduled: no group meetings, assessments or polygraphs coming up.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(item => (
            <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className={`w-24 shrink-0 font-semibold ${item.day === today ? 'text-blue-300' : 'text-slate-200'}`}>{dayText(item.day, today)}</span>
              <span className={`flex items-center gap-1 border rounded px-1.5 py-0.5 text-xs font-semibold ${TONE_CHIP[item.tone]}`}>
                {item.kind && <KindIcon kind={item.kind} />}
                {item.tone === 'cancelled' && <CalendarX size={11} className="shrink-0" />}
                {item.what}
              </span>
              <span className="text-xs text-slate-400 min-w-0">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {phaseNote && <p className="text-xs text-slate-500">{phaseNote}</p>}
    </section>
  );
}
