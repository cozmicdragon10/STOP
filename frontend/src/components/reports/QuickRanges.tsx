import { todayLocal } from '../../hooks/useGroupCheckIn';
import { DAY_TO_DAY_RANGES, RANGE_LABEL, activeRange, dateRange, type RangeKey } from '../../utils/dateRanges';

// Buttons beside a report's From/To boxes that fill both in one click ("This Week", "Last Month", ...). The range the
// dates are showing is lit up, so it's clear what the report covers.
export default function QuickRanges({ from, to, onPick, ranges = DAY_TO_DAY_RANGES }: {
  from: string;
  to: string;
  onPick: (from: string, to: string) => void;
  ranges?: RangeKey[];
}) {
  const today = todayLocal();
  const active = activeRange(ranges, from, to, today);
  return (
    <div role="group" aria-label="Quick date ranges" className="flex flex-wrap gap-1.5">
      {ranges.map(key => {
        const on = key === active;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => { const r = dateRange(key, today); onPick(r.from, r.to); }}
            className={`h-9 px-3 rounded text-xs font-semibold border transition ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'}`}>
            {RANGE_LABEL[key]}
          </button>
        );
      })}
    </div>
  );
}
