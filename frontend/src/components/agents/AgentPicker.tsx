import { useState } from 'react';
import type { SupervisingAgent } from '../../api';

interface Props {
  value: string;
  onChange: (value: string) => void;
  agents: SupervisingAgent[];
  className?: string;
}

// Free-text agent name with the directory's agents listed as you focus and type.
// Names not in the directory are still accepted, matching how clients store their agent.
export default function AgentPicker({ value, onChange, agents, className }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const term = value.trim().toLowerCase();
  const matches = agents.filter(a => !term || a.name.toLowerCase().includes(term));
  // Hide the list once the box holds exactly one agent's name
  const showList = open && matches.length > 0 && !(matches.length === 1 && matches[0].name.toLowerCase() === term);

  const pick = (agent: SupervisingAgent) => {
    onChange(agent.name);
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
    } else if (e.key === 'Enter' && showList && matches[highlight]) {
      e.preventDefault();
      pick(matches[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        autoComplete="off"
        onFocus={() => { setOpen(true); setHighlight(0); }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
        className={className}
      />
      {showList && (
        <ul className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1">
          {matches.map((a, i) => (
            <li
              key={a.agentid}
              // mousedown fires before the input's blur, so the pick lands before the list closes
              onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-2 cursor-pointer text-sm ${i === highlight ? 'bg-blue-500/15 text-white' : 'text-slate-300'}`}
            >
              <p className="font-medium">{a.name}</p>
              {(a.phone || a.email) && <p className="text-xs text-slate-500">{[a.phone, a.email].filter(Boolean).join(' · ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
