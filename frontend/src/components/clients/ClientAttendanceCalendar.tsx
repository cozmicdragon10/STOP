import { useState } from 'react';
import { CalendarX, ChevronLeft, ChevronRight, UserX } from 'lucide-react';
import { localYmd } from '../../utils/dates';
import { signedMoney } from '../../utils/ledger';
import { monthGrid, shiftMonth } from '../../utils/counselor';
import { TONE_CHIP, dayCellClass, dayChipsClass, dayWhen, type CalendarTone } from '../../utils/calendar';
import { clientCalendarEntries, hasUpcoming, phaseAttendanceNote, type ClientCalendarData, type ClientCalendarEntry } from '../../utils/clientCalendar';
import { CalendarLegend, DayNumber, KindIcon, type CalendarKind } from '../calendar/CalendarKey';

/* eslint-disable @typescript-eslint/no-explicit-any -- attendance rows are untyped throughout App */
interface Props {
  // Attendance rows, cancelled-group rows (cancellation: true) and missed-group rows (missed: true), already filtered
  rows: any[];
  // The client's group schedule, booked assessments and polygraphs, and polygraphs taken; null until loaded
  schedule: ClientCalendarData | null;
  // Filters are on: only the filtered attendance shows, not the schedule
  filtered: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// An attendance row's color (its state) and icon (its kind)
const rowTone = (row: { cancellation?: boolean; missed?: boolean }): CalendarTone =>
  row.missed ? 'missed' : row.cancellation ? 'cancelled' : 'done';
const rowKind = (row: { cancellation?: boolean; missed?: boolean; type?: string }): CalendarKind | undefined =>
  row.cancellation || row.missed ? undefined : row.type === 'Assessment' ? 'assessment' : row.type === 'Individual' ? 'individual' : undefined;

interface Chip {
  key: string;
  tone: CalendarTone;
  kind?: CalendarKind;
  label: string;
  title: string;
  icon?: 'cancelled' | 'missed';
}

const rowChip = (r: any): Chip => {
  const name = r.cancellation || r.missed ? r.groupname : (r.groupname || 'Group Session');
  const title = r.missed
    ? `${r.missedLabel}: ${name}${r.calledin ? ` (called in${r.callinreason ? `: ${r.callinreason}` : ''})` : ''}`
    : r.cancellation
    ? `${name}: group cancelled${r.reason ? ` (${r.reason})` : ''}`
    : `${name}${r.groupschedule ? ` · ${r.groupschedule}` : ''}\nFee ${signedMoney(Number(r.groupfee || 0))} · Paid ${signedMoney(Number(r.accountpaid || 0))}${r.comments ? `\n${r.comments}` : ''}`;
  return {
    key: r.missed ? `missed-${r.groupid}-${r.date}` : r.cancellation ? `cancel-${r.changeid}` : `att-${r.attendanceid}`,
    tone: rowTone(r),
    kind: rowKind(r),
    // A cancelled meeting's color, line-through and icon already say so; the name gets the room
    label: r.missed ? `Missed: ${name}` : name,
    title,
    icon: r.cancellation ? 'cancelled' : r.missed ? 'missed' : undefined,
  };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// Attendance types that mean the client came to group that week (a meeting that day isn't still "coming up")
const GROUP_CHECK_IN_TYPES = new Set(['Group', 'Make-Up']);

// The client's calendar: what they attended, the group meetings they missed or that were cancelled, and what's coming
// up (their group's next meetings, booked assessments and polygraphs). Opens on this month when something is coming up,
// else on the month of the newest session.
export default function ClientAttendanceCalendar({ rows, schedule, filtered }: Props) {
  const today = localYmd(new Date());
  const thisMonth = today.slice(0, 7);
  // null until the user moves to another month
  const [picked, setPicked] = useState<string | null>(null);
  const newest = rows.map(r => localYmd(r.date)).filter(Boolean).sort().pop();
  const shownSchedule = filtered ? null : schedule;
  const month = picked ?? (hasUpcoming(shownSchedule) || !newest ? thisMonth : newest.slice(0, 7));
  const go = (by: number) => setPicked(shiftMonth(month, by));

  // Attendance rows by day
  const byDay = new Map<string, Chip[]>();
  const addChip = (day: string, chip: Chip) => byDay.set(day, [...(byDay.get(day) ?? []), chip]);
  for (const r of rows) addChip(localYmd(r.date), rowChip(r));

  // Then the schedule: upcoming group meetings, booked times, polygraphs
  const checkedInDays = new Set(rows.filter(r => !r.cancellation && !r.missed && GROUP_CHECK_IN_TYPES.has(r.type)).map(r => localYmd(r.date)));
  const shownChangeIds = new Set<number>(rows.filter(r => r.cancellation).map(r => Number(r.changeid)));
  const scheduled: Map<string, ClientCalendarEntry[]> = shownSchedule ? clientCalendarEntries(shownSchedule, month, checkedInDays, shownChangeIds) : new Map();
  for (const [day, entries] of scheduled) {
    for (const e of entries) addChip(day, { ...e, icon: e.tone === 'cancelled' ? 'cancelled' : undefined });
  }

  const inMonth = rows.filter(r => localYmd(r.date).startsWith(month));
  const sessions = inMonth.filter(r => !r.cancellation && !r.missed).length;
  const cancelled = inMonth.filter(r => r.cancellation).length;
  const missed = inMonth.filter(r => r.missed).length;
  const comingUp = [...scheduled.values()].flat().filter(e => e.tone === 'booked').length;
  const phaseNote = shownSchedule?.group ? phaseAttendanceNote(shownSchedule.phase) : '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go(-1)} aria-label="Previous month" className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"><ChevronLeft size={16} /></button>
        <p className="font-bold text-white min-w-[9rem] text-center">{new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</p>
        <button type="button" onClick={() => go(1)} aria-label="Next month" className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"><ChevronRight size={16} /></button>
        {month !== thisMonth && (
          <button type="button" onClick={() => setPicked(thisMonth)} className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300">This Month</button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {sessions} session{sessions === 1 ? '' : 's'}{cancelled > 0 && ` · ${cancelled} group${cancelled === 1 ? '' : 's'} cancelled`}{missed > 0 && ` · ${missed} missed`}{comingUp > 0 && ` · ${comingUp} coming up`}
        </span>
      </div>
      {filtered && <p className="text-xs text-slate-500">Filters are on, so only the matching attendance shows. Clear them to see what's coming up.</p>}
      {phaseNote && <p className="text-xs text-slate-400">{phaseNote}</p>}

      <div className="grid grid-cols-7 gap-1 text-[0.6875rem]">
        {WEEKDAYS.map(d => <p key={d} className="text-center font-semibold uppercase tracking-wide text-slate-500 pb-1">{d}</p>)}
        {monthGrid(month).map((day, i) => {
          if (!day) return <div key={`blank-${i}`} className="min-h-[4.5rem] rounded-lg bg-slate-950/40" />;
          const when = dayWhen(day, today);
          const chips = byDay.get(day) || [];
          return (
            <div key={day} className={`min-h-[4.5rem] rounded-lg border p-1 space-y-1 ${dayCellClass(when)}`}>
              <div className="flex justify-end"><DayNumber day={day} when={when} /></div>
              <div className={`space-y-1 ${dayChipsClass(when)}`}>
                {chips.map(c => (
                  <p key={c.key} title={c.title} className={`border rounded px-1 py-0.5 truncate font-semibold flex items-center gap-1 ${TONE_CHIP[c.tone].replace('line-through', '')}`}>
                    {c.icon === 'cancelled' && <CalendarX size={11} className="shrink-0" />}
                    {c.icon === 'missed' && <UserX size={11} className="shrink-0" />}
                    {c.kind && <KindIcon kind={c.kind} />}
                    <span className={`truncate ${c.tone === 'cancelled' ? 'line-through' : ''}`}>{c.label}</span>
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <CalendarLegend
        tones={['done', 'booked', 'cancelled', 'moved', 'missed']}
        labels={{ done: 'Attended / taken' }}
        kinds={['assessment', 'individual', 'polygraph']}
      />
    </div>
  );
}
