import { useState } from 'react';
import { CalendarX, UserX } from 'lucide-react';
import { localYmd } from '../../utils/dates';
import { signedMoney } from '../../utils/ledger';
import { TONE_CHIP, type CalendarTone } from '../../utils/calendar';
import { clientCalendarEntries, groupCheckInDays, hasUpcoming, phaseAttendanceNote, type ClientCalendarData, type ClientCalendarEntry } from '../../utils/clientCalendar';
import { CalendarLegend, KindIcon, type CalendarKind } from '../calendar/CalendarKey';
import MonthCalendar from '../calendar/MonthCalendar';

/* eslint-disable @typescript-eslint/no-explicit-any -- attendance rows are untyped throughout App */
interface Props {
  // Attendance rows, cancelled-group rows (cancellation: true) and missed-group rows (missed: true), already filtered
  rows: any[];
  // The client's group schedule, booked assessments and polygraphs, and polygraphs taken; null until loaded
  schedule: ClientCalendarData | null;
  // Filters are on: only the filtered attendance shows, not the schedule
  filtered: boolean;
}

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

  // Attendance rows by day
  const byDay = new Map<string, Chip[]>();
  const addChip = (day: string, chip: Chip) => byDay.set(day, [...(byDay.get(day) ?? []), chip]);
  for (const r of rows) addChip(localYmd(r.date), rowChip(r));

  // Then the schedule: upcoming group meetings, booked times, polygraphs
  const checkedInDays = groupCheckInDays(rows);
  const shownChangeIds = new Set<number>(rows.filter(r => r.cancellation).map(r => Number(r.changeid)));
  const scheduled: Map<string, ClientCalendarEntry[]> = shownSchedule ? clientCalendarEntries(shownSchedule, month, checkedInDays, shownChangeIds) : new Map();
  for (const [day, entries] of scheduled) {
    for (const e of entries) addChip(day, { ...e, icon: e.tone === 'cancelled' ? 'cancelled' : undefined });
  }

  const inMonth = rows.filter(r => localYmd(r.date).startsWith(month));
  const sessions = inMonth.filter(r => !r.cancellation && !r.missed).length;
  const cancelled = inMonth.filter(r => r.cancellation).length;
  const missed = inMonth.filter(r => r.missed).length;
  const comingUp = [...scheduled.values()].flat().filter(e => e.tone === 'booked' || e.tone === 'assessment').length;
  const phaseNote = shownSchedule?.group ? phaseAttendanceNote(shownSchedule.phase) : '';

  return (
    <div className="space-y-3">
      {filtered && <p className="text-xs text-slate-500">Filters are on, so only the matching attendance shows. Clear them to see what's coming up.</p>}
      {phaseNote && <p className="text-xs text-slate-400">{phaseNote}</p>}
      <MonthCalendar
        month={month}
        today={today}
        onMonth={setPicked}
        summary={<>{sessions} session{sessions === 1 ? '' : 's'}{cancelled > 0 && ` · ${cancelled} group${cancelled === 1 ? '' : 's'} cancelled`}{missed > 0 && ` · ${missed} missed`}{comingUp > 0 && ` · ${comingUp} coming up`}</>}
        cellClassName="min-h-[4.5rem]"
        renderDay={day => (byDay.get(day) || []).map(c => (
          <p key={c.key} title={c.title} className={`border rounded px-1 py-0.5 text-[11px] leading-tight truncate font-semibold flex items-center gap-1 ${TONE_CHIP[c.tone].replace('line-through', '')}`}>
            {c.icon === 'cancelled' && <CalendarX size={11} className="shrink-0" />}
            {c.icon === 'missed' && <UserX size={11} className="shrink-0" />}
            {c.kind && <KindIcon kind={c.kind} />}
            <span className={`truncate ${c.tone === 'cancelled' ? 'line-through' : ''}`}>{c.label}</span>
          </p>
        ))}
        legend={
          <CalendarLegend
            tones={['done', 'booked', 'assessment', 'cancelled', 'moved', 'missed']}
            labels={{ done: 'Attended / taken' }}
            kinds={['assessment', 'individual', 'polygraph']}
          />
        }
      />
    </div>
  );
}
