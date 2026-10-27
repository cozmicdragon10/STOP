import { useState } from 'react';

interface PickerGroup {
  groupid: number;
  groupname: string;
  schedule?: string | null;
  location?: string | null;
}

interface Props {
  groups: PickerGroup[];
  // Selected group id as a string; '' when none is picked
  value: string;
  onChange: (groupId: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}

const MAX_RESULTS = 50;

// Type a group name, schedule or location to find a group. Only a group picked from the list counts as a selection;
// leaving the box with unmatched text puts back the current selection.
export default function GroupPicker({ groups, value, onChange, placeholder = 'Search group name, schedule or location...', className, required }: Props) {
  const selected = groups.find(g => String(g.groupid) === value) ?? null;
  const [text, setText] = useState(selected ? selected.groupname : '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Follow selection changes made outside the box, such as clearing it after a call-in is logged
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(selected ? selected.groupname : '');
  }

  const term = text.trim().toLowerCase();
  const searching = open && (!selected || text !== selected.groupname);
  const matches = (searching && term
    ? groups.filter(g => `${g.groupname} ${g.schedule ?? ''} ${g.location ?? ''}`.toLowerCase().includes(term))
    : groups
  ).slice(0, MAX_RESULTS);

  const pick = (g: PickerGroup) => {
    onChange(String(g.groupid));
    setText(g.groupname);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && open && matches[highlight]) {
      e.preventDefault();
      pick(matches[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setText(selected ? selected.groupname : '');
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={text}
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        onFocus={(e) => { setOpen(true); setHighlight(0); e.target.select(); }}
        onBlur={() => { setOpen(false); setText(selected ? selected.groupname : ''); }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHighlight(0);
          // Clearing the box clears the selection
          if (!e.target.value.trim() && value) onChange('');
        }}
        onKeyDown={onKeyDown}
        className={className}
      />
      {open && (
        <ul className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1">
          {matches.map((g, i) => (
            <li
              key={g.groupid}
              // mousedown fires before the input's blur, so the pick lands before the list closes
              onMouseDown={(e) => { e.preventDefault(); pick(g); }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-1.5 cursor-pointer text-xs flex justify-between gap-3 ${i === highlight ? 'bg-blue-500/15 text-white' : 'text-slate-300'}`}
            >
              <span className="truncate">{g.groupname}</span>
              {g.schedule && <span className="text-slate-500 shrink-0">{g.schedule}</span>}
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No groups match.</li>}
        </ul>
      )}
    </div>
  );
}
