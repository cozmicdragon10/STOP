import { useState } from 'react';

interface PickerClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
}

interface Props {
  clients: PickerClient[];
  // Selected client id as a string; '' when none is picked
  value: string;
  onChange: (clientId: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}

const MAX_RESULTS = 50;
const labelFor = (c: PickerClient) => `${c.lastname}, ${c.firstname}`;

// Type a name or DOC # to find a client. Only a client picked from the list counts as a selection;
// leaving the box with unmatched text puts back the current selection.
export default function ClientPicker({ clients, value, onChange, placeholder = 'Search name or DOC #...', className, required }: Props) {
  const selected = clients.find(c => String(c.clientid) === value) ?? null;
  const [text, setText] = useState(selected ? labelFor(selected) : '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Follow selection changes made outside the box, such as clearing it after a slot is assigned
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(selected ? labelFor(selected) : '');
  }

  const term = text.trim().toLowerCase();
  const searching = open && (!selected || text !== labelFor(selected));
  const matches = (searching && term
    ? clients.filter(c => `${c.lastname}, ${c.firstname} ${c.firstname} ${c.lastname} ${c.docnumber ?? ''}`.toLowerCase().includes(term))
    : clients
  ).slice(0, MAX_RESULTS);

  const pick = (c: PickerClient) => {
    onChange(String(c.clientid));
    setText(labelFor(c));
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
      setText(selected ? labelFor(selected) : '');
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
        onBlur={() => { setOpen(false); setText(selected ? labelFor(selected) : ''); }}
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
          {matches.map((c, i) => (
            <li
              key={c.clientid}
              // mousedown fires before the input's blur, so the pick lands before the list closes
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-1.5 cursor-pointer text-xs flex justify-between gap-3 ${i === highlight ? 'bg-blue-500/15 text-white' : 'text-slate-300'}`}
            >
              <span className="truncate">{labelFor(c)}</span>
              {c.docnumber && <span className="text-slate-500 font-mono shrink-0">{c.docnumber}</span>}
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No clients match.</li>}
        </ul>
      )}
    </div>
  );
}
