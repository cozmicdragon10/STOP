import { Activity, ClipboardList, User } from 'lucide-react';
import { TONE_CHIP, TONE_LABEL, dayNumberClass, type CalendarTone, type DayWhen } from '../../utils/calendar';

// The kinds of entry an icon marks on a chip; group meetings carry no icon
export type CalendarKind = 'assessment' | 'individual' | 'polygraph';
const KIND_ICON = { assessment: ClipboardList, individual: User, polygraph: Activity } as const;
const KIND_LABEL: Record<CalendarKind, string> = { assessment: 'Assessment', individual: 'Individual session', polygraph: 'Polygraph' };

export function KindIcon({ kind, size = 11 }: { kind: CalendarKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} className="shrink-0" aria-hidden="true" />;
}

// A day cell's number, with "Today" beside it on today
export function DayNumber({ day, when }: { day: string; when: DayWhen }) {
  return (
    <span className={`text-xs flex items-baseline gap-1 ${dayNumberClass(when)}`}>
      {Number(day.slice(8))}
      {when === 'today' && <span className="text-[9px] uppercase tracking-wide font-semibold">Today</span>}
    </span>
  );
}

// The legend under a calendar: the colors it uses (labels can be worded for that calendar), the icons it uses, and how
// past days and today look
export function CalendarLegend({ tones, labels = {}, kinds = [] }: { tones: CalendarTone[]; labels?: Partial<Record<CalendarTone, string>>; kinds?: CalendarKind[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
      {tones.map(t => (
        <span key={t} className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded border ${TONE_CHIP[t].replace('line-through', '')}`} /> {labels[t] ?? TONE_LABEL[t]}
        </span>
      ))}
      {kinds.map(k => (
        <span key={k} className="flex items-center gap-1.5"><KindIcon kind={k} size={12} /> {KIND_LABEL[k]}</span>
      ))}
      <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-blue-500/70 bg-blue-500/5" /> Today</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-slate-800/70 bg-slate-950/70" /> Past days</span>
    </div>
  );
}
