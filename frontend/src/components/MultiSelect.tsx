import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface Props {
  // Shown on the button: "Status: All", "Status: Active", "Status: 3 selected"
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  // How an option is shown (the stored value stays the same)
  optionLabel?: (value: string) => string;
}

// A dropdown of checkboxes for picking any number of values; nothing picked means All. Long lists get a search box.
export default function MultiSelect({ label, options, selected, onChange, optionLabel = v => v }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // Close on a click outside or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const picked = new Set(selected);
  const toggle = (value: string) => onChange(picked.has(value) ? selected.filter(v => v !== value) : [...selected, value]);
  // Selected values that aren't offered any more (e.g. after another filter changed) still show, so they can be unticked
  const all = [...options, ...selected.filter(v => !options.includes(v))];
  const term = search.trim().toLowerCase();
  const shown = term ? all.filter(v => optionLabel(v).toLowerCase().includes(term)) : all;
  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? optionLabel(selected[0]) : `${selected.length} selected`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setSearch(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 bg-slate-950 border rounded-lg px-3 py-1.5 text-xs text-white max-w-[16rem] ${selected.length ? 'border-blue-500/60' : 'border-slate-700'}`}
      >
        <span className="truncate">{label}: {summary}</span>
        <ChevronDown size={13} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-full w-64 max-md:fixed max-md:z-50 max-md:top-16 max-md:inset-x-4 max-md:w-auto max-md:min-w-0 max-md:mt-0 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-1">
          {options.length > 12 && (
            <input
              type="search"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full mb-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white placeholder-slate-500"
            />
          )}
          <div role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-72 max-md:max-h-[60dvh] overflow-y-auto">
            {shown.map(value => (
              <label key={value} role="option" aria-selected={picked.has(value)} className="flex items-center gap-2 px-2 py-1.5 max-md:py-2.5 max-md:text-sm rounded text-xs text-slate-200 hover:bg-slate-800 cursor-pointer">
                <input type="checkbox" checked={picked.has(value)} onChange={() => toggle(value)} className="accent-blue-500" />
                <span className="truncate">{optionLabel(value)}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">No matches.</p>}
          </div>
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full mt-1 flex items-center justify-center gap-1 border-t border-slate-800 pt-1.5 pb-1 text-xs text-slate-400 hover:text-white">
              <X size={12} /> Clear ({label}: All)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
