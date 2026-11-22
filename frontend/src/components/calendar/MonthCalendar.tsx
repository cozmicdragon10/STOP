import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthGrid, shiftMonth } from '../../utils/counselor';
import { dayCellClass, dayChipsClass, dayWhen, type DayWhen } from '../../utils/calendar';
import { DayNumber } from './CalendarKey';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  // 'YYYY-MM' shown, and today ('YYYY-MM-DD')
  month: string;
  today: string;
  // The arrows; onToday is the "Today" link shown on other months (default: go to this month)
  onMonth: (month: string) => void;
  onToday?: () => void;
  // A line under the month's name, like "3 open · 1 scheduled"
  summary?: ReactNode;
  // What's in a day's box (chips); the day number is drawn already
  renderDay: (day: string, when: DayWhen) => ReactNode;
  // Clicking a day picks it (the picked day is outlined); without onPickDay days aren't clickable
  pickedDay?: string | null;
  onPickDay?: (day: string) => void;
  // A day's spoken label for screen readers, like "Tuesday, December 8: 1 open"
  dayLabel?: (day: string) => string;
  // A day box's height; and a minimum grid width (it scrolls sideways on narrow screens instead of squeezing)
  cellClassName?: string;
  minWidthClassName?: string;
  // Under the grid
  legend?: ReactNode;
}

// The month calendar every calendar in the app uses (My Day / Calendars tab, Assessments, Polygraph Schedule, a
// client's Attendance): the same header, weekday row, day boxes, past/today look (utils/calendar.ts) and legend spot.
export default function MonthCalendar({
  month, today, onMonth, onToday, summary, renderDay, pickedDay, onPickDay, dayLabel,
  cellClassName = 'min-h-[3.25rem] sm:min-h-[4.5rem]', minWidthClassName = '', legend,
}: Props) {
  const [year, monthNumber] = month.split('-').map(Number);
  const title = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const isThisMonth = month === today.slice(0, 7);
  const arrow = 'p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition';

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <button type="button" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month" className={arrow}>
          <ChevronLeft size={16} />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-slate-500">
            {summary}
            {!isThisMonth && (
              <>{summary ? ' · ' : ''}<button type="button" onClick={onToday ?? (() => onMonth(today.slice(0, 7)))} className="text-blue-400 hover:text-blue-300 font-medium">Today</button></>
            )}
          </p>
        </div>
        <button type="button" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month" className={arrow}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className={minWidthClassName ? 'overflow-x-auto' : ''}>
        <div className={minWidthClassName}>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            {WEEKDAYS.map(w => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthGrid(month).map((day, i) => {
              if (!day) return <div key={`blank-${i}`} />;
              const when = dayWhen(day, today);
              const picked = day === pickedDay;
              const box = `${cellClassName} rounded-lg border p-1 sm:p-1.5 text-left flex flex-col gap-1 min-w-0 transition ${dayCellClass(when, picked)}`;
              const inside = (
                <>
                  <DayNumber day={day} when={when} />
                  <div className={`flex flex-col gap-1 min-w-0 ${dayChipsClass(when)}`}>{renderDay(day, when)}</div>
                </>
              );
              if (!onPickDay) return <div key={day} aria-label={dayLabel?.(day)} className={box}>{inside}</div>;
              // A div acting as a button, since a day's chips can be buttons of their own
              return (
                <div
                  key={day}
                  role="button"
                  tabIndex={0}
                  aria-pressed={picked}
                  aria-label={dayLabel?.(day)}
                  onClick={() => onPickDay(day)}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPickDay(day); } }}
                  className={`${box} cursor-pointer hover:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>
                  {inside}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {legend && <div className="mt-3">{legend}</div>}
    </div>
  );
}
