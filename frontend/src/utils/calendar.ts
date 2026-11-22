// The look every month calendar shares (My Day / Calendars tab, Assessments, Polygraph Schedule, a client's Attendance
// calendar), so a color means the same thing wherever it shows up. Color is what state an entry is in; an icon on the
// chip says what kind of entry it is (assessment, individual, polygraph). Days before today are dimmed and today is
// outlined.

// What an entry's color means
export type CalendarTone =
  | 'done'       // happened: a closed session, an attended session, a polygraph taken
  | 'open'       // a check-in sheet still open, waiting to be closed
  | 'booked'     // scheduled, with someone expected: an upcoming group meeting, a client's booked time
  | 'available'  // an open time nobody is booked into yet
  | 'cancelled'
  | 'moved'      // moved to another day (shown on the day it was moved from)
  | 'missed'     // the client was expected and didn't come
  | 'closed';    // a polygraph slot closed without being used

export const TONE_CHIP: Record<CalendarTone, string> = {
  done: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  open: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  // Filled, so it stands apart from an open time's empty dashed box
  booked: 'bg-blue-500/25 border-dashed border-blue-400/80 text-blue-200',
  available: 'bg-transparent border-dashed border-slate-500/70 text-slate-300',
  cancelled: 'bg-rose-500/10 border-rose-500/40 text-rose-300 line-through',
  moved: 'bg-transparent border-dashed border-rose-400/50 text-rose-300',
  missed: 'bg-red-500/20 border-red-500/60 text-red-200',
  closed: 'bg-slate-800 border-slate-700 text-slate-400',
};

// The legend's wording, unless a calendar words one differently
export const TONE_LABEL: Record<CalendarTone, string> = {
  done: 'Happened',
  open: 'Check-in still open',
  booked: 'Scheduled, coming up',
  available: 'Open time, nobody booked',
  cancelled: 'Cancelled',
  moved: 'Moved to another day',
  missed: 'Missed',
  closed: 'Closed, not used',
};

// A day ('YYYY-MM-DD') against today
export type DayWhen = 'past' | 'today' | 'future';
export const dayWhen = (day: string, today: string): DayWhen => (day < today ? 'past' : day === today ? 'today' : 'future');

// A day cell's border and background: picked (clicked) days stand out most, then today; past days are dimmed
export const dayCellClass = (when: DayWhen, picked = false) => {
  if (picked) return 'border-blue-400 bg-blue-500/10 ring-1 ring-blue-400/60';
  if (when === 'today') return 'border-blue-500/70 bg-blue-500/5';
  if (when === 'past') return 'border-slate-800/70 bg-slate-950/70';
  return 'border-slate-700 bg-slate-900';
};

// The day number in a cell
export const dayNumberClass = (when: DayWhen) =>
  when === 'today' ? 'text-blue-300 font-bold' : when === 'past' ? 'text-slate-600 font-semibold' : 'text-slate-300 font-semibold';

// Chips on a past day are a little dimmed too, so the eye goes to today and what's coming
export const dayChipsClass = (when: DayWhen) => (when === 'past' ? 'opacity-75' : '');
