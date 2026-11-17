import { ChevronLeft, ChevronRight } from 'lucide-react';
import { relativeDayName, shiftDay } from '../../utils/home';

interface Props {
  // YYYY-MM-DD, local
  day: string;
  today: string;
  onChange: (day: string) => void;
}

const DAY_BUTTON = 'p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700';

// The Home page's day heading ("Tomorrow · Wednesday, November 18") with previous / next day, a date box, and a
// Today button while another day is showing
export default function DayPicker({ day, today, onChange }: Props) {
  const [y, m, d] = day.split('-').map(Number);
  const dayLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: y === Number(today.slice(0, 4)) ? undefined : 'numeric',
  });
  const relative = relativeDayName(day, today);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
      <h3 className="text-xs uppercase tracking-wide text-slate-400 font-semibold mr-auto">
        {relative ? `${relative} · ` : ''}{dayLabel}
      </h3>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => onChange(shiftDay(day, -1))} aria-label="Previous day" title="Previous day" className={DAY_BUTTON}>
          <ChevronLeft size={14} />
        </button>
        <input
          type="date"
          value={day}
          onChange={e => { if (e.target.value) onChange(e.target.value); }}
          aria-label="Pick a day"
          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-xs [color-scheme:dark]"
        />
        <button type="button" onClick={() => onChange(shiftDay(day, 1))} aria-label="Next day" title="Next day" className={DAY_BUTTON}>
          <ChevronRight size={14} />
        </button>
        {day !== today && (
          <button type="button" onClick={() => onChange(today)} className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold">
            Today
          </button>
        )}
      </div>
    </div>
  );
}
