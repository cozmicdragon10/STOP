import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { TableSort } from '../hooks/useTableSort';

// A column header that sorts its table when clicked (ascending, descending, then back to the table's own order).
// It keeps the header's own look (className) and adds the sort arrow; right-aligned headers stay right-aligned.
export default function SortableTh<K extends string>({ k, table, className = '', title, children }: {
  k: K; table: TableSort<K>; className?: string; title?: string; children: ReactNode;
}) {
  const active = table.sort?.key === k ? table.sort.dir : null;
  const Icon = !active ? ArrowUpDown : active === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={className} title={title} aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : undefined}>
      <button type="button" onClick={() => table.toggle(k)}
        className={`inline-flex items-center gap-1 [text-transform:inherit] [letter-spacing:inherit] hover:text-white ${active ? 'text-white' : ''}`}>
        {children}
        <Icon size={12} aria-hidden className={`shrink-0 ${active ? 'text-blue-400' : 'text-slate-600'}`} />
      </button>
    </th>
  );
}
