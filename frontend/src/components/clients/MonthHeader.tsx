import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  label: string;
  count: number;
  // Singular noun for the count, e.g. "session" or "entry"
  noun: string;
  collapsed: boolean;
  onToggle: () => void;
  // Month totals shown on the right
  children?: ReactNode;
}

// Collapsible month heading for a client's record lists (attendance, financial ledger)
export default function MonthHeader({ label, count, noun, collapsed, onToggle, children }: Props) {
  const plural = noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-2 pb-1 border-b border-slate-800 text-left hover:text-white"
    >
      {collapsed ? <ChevronRight size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      <span className="text-sm font-semibold text-white">{label}</span>
      <span className="text-xs text-slate-500">{count} {count === 1 ? noun : plural}</span>
      <span className="ml-auto flex gap-4 text-xs">{children}</span>
    </button>
  );
}
