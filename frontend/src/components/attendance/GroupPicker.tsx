import { useState } from 'react';
import type { GroupRecord } from '../../hooks/useGroupCheckIn';

interface Props {
  id?: string;
  groups: GroupRecord[];
  // The picked group's id; null when none is picked
  value: number | null;
  onChange: (groupId: number | null) => void;
  disabled?: boolean;
  className?: string;
}

// Type part of a group's name (or its counselor) to find it. Only a group picked from the list counts as a selection;
// leaving the box with unmatched text puts back the current selection. Works like ClientPicker.
export default function GroupPicker({ id, groups, value, onChange, disabled, className }: Props) {
  const selected = groups.find(g => g.groupid === value) ?? null;
  const [text, setText] = useState(selected?.groupname ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Follow selection changes made outside the box, such as opening a saved group or the groups loading
  const [shown, setShown] = useState<string>(`${value}|${selected?.groupname ?? ''}`);
  const shownKey = `${value}|${selected?.groupname ?? ''}`;
  if (shownKey !== shown) {
    setShown(shownKey);
    setText(selected?.groupname ?? '');
  }

  // Every word typed must appear in the name or counselor, so "law so" finds "Lawton SO"
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = open && (!selected || text !== selected.groupname);
  const matches = searching && words.length > 0
    ? groups.filter(g => { const hay = `${g.groupname} ${g.counselor ?? ''}`.toLowerCase(); return words.every(w => hay.includes(w)); })
    : groups;

  const pick = (g: GroupRecord) => {
    onChange(g.groupid);
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
      setText(selected?.groupname ?? '');
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={text}
        autoComplete="off"
        disabled={disabled}
        placeholder="Type to search groups..."
        onFocus={e => { setOpen(true); setHighlight(0); e.target.select(); }}
        onBlur={() => { setOpen(false); setText(selected?.groupname ?? ''); }}
        onChange={e => {
          setText(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && !disabled && (
        <ul className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1" role="listbox">
          {matches.map((g, i) => (
            <li
              key={g.groupid}
              role="option"
              aria-selected={g.groupid === value}
              // mousedown fires before the input's blur, so the pick lands before the list closes
              onMouseDown={e => { e.preventDefault(); pick(g); }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-2 cursor-pointer text-sm flex justify-between gap-3 ${i === highlight ? 'bg-blue-500/15 text-white' : g.groupid === value ? 'text-blue-300' : 'text-slate-300'}`}
            >
              <span className="truncate">{g.groupname}</span>
              {g.counselor && <span className="text-slate-500 text-xs shrink-0 self-center">{g.counselor}</span>}
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No groups match.</li>}
        </ul>
      )}
    </div>
  );
}
