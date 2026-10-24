import { X } from 'lucide-react';

export interface RecordFilterSelect {
  label: string;
  value: string;
  onChange: (value: string) => void;
  // The first option ('' value) is labelled with allLabel
  allLabel: string;
  options: string[];
}

interface Props {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  selects: RecordFilterSelect[];
  // YYYY-MM-DD, inclusive; '' means open-ended
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  sort: string;
  onSort: (value: string) => void;
  sortOptions: { value: string; label: string }[];
  shown: number;
  total: number;
  onClear: () => void;
}

// Search, dropdown filters, date range, and sort for a client's record lists (case notes, financial ledger)
export default function RecordFilterBar({ search, onSearch, searchPlaceholder, selects, from, to, onFrom, onTo, sort, onSort, sortOptions, shown, total, onClear }: Props) {
  const active = !!(search.trim() || from || to || selects.some(s => s.value));
  const control = 'block mt-1 h-8 bg-slate-950 border border-slate-700 rounded-lg px-2.5 text-xs text-slate-200';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-400 flex-1 min-w-[10rem]">Search
          <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder} className={`${control} w-full placeholder-slate-500`} />
        </label>
        {selects.map(s => (
          <label key={s.label} className="text-[11px] text-slate-400">{s.label}
            <select value={s.value} onChange={(e) => s.onChange(e.target.value)} className={control}>
              <option value="">{s.allLabel}</option>
              {s.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <label className="text-[11px] text-slate-400">From
          <input type="date" value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} className={control} />
        </label>
        <label className="text-[11px] text-slate-400">To
          <input type="date" value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} className={control} />
        </label>
        <label className="text-[11px] text-slate-400">Sort
          <select value={sort} onChange={(e) => onSort(e.target.value)} className={control}>
            {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <div className="flex justify-between items-center text-[11px] text-slate-500">
        <span>Showing {shown} of {total}</span>
        {active && (
          <button type="button" onClick={onClear} className="flex items-center gap-1 text-slate-400 hover:text-white">
            <X size={11} /> Clear Filters
          </button>
        )}
      </div>
    </div>
  );
}
