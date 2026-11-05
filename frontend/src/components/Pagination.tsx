import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface Props {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  // What the list holds, for the "Showing 1–50 of 817 clients" label
  noun?: string;
}

// Page numbers to show: the first, the last, and two either side of the current page, with null for a gap
const pageNumbers = (page: number, pageCount: number): (number | null)[] => {
  const shown = new Set([1, pageCount]);
  for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= pageCount) shown.add(p);
  const sorted = [...shown].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? [null, p] : [p]));
};

// Page controls under a list. Hidden when everything fits on one page.
export default function Pagination({ page, pageCount, pageSize, total, onPageChange, noun = 'items' }: Props) {
  if (pageCount <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const arrow = 'p-1.5 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none';
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 text-xs">
      <span className="text-slate-400">Showing {first}–{last} of {total} {noun}</span>
      {/* Phones keep the arrows and the current page; the other page numbers don't fit at a tappable size */}
      <div className="flex items-center justify-center gap-1 w-full sm:w-auto">
        <button type="button" onClick={() => onPageChange(1)} disabled={page === 1} title="First page" className={arrow}><ChevronsLeft size={14} /></button>
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page === 1} title="Previous page" className={arrow}><ChevronLeft size={14} /></button>
        {pageNumbers(page, pageCount).map((p, i) => p === null ? (
          <span key={`gap-${i}`} className="max-sm:hidden px-1.5 text-slate-500">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`min-w-[2rem] px-2 py-1 rounded border font-semibold ${p === page ? 'bg-blue-600 border-blue-600 text-white' : 'max-sm:hidden bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700'}`}
          >
            {p}
          </button>
        ))}
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page === pageCount} title="Next page" className={arrow}><ChevronRight size={14} /></button>
        <button type="button" onClick={() => onPageChange(pageCount)} disabled={page === pageCount} title="Last page" className={arrow}><ChevronsRight size={14} /></button>
      </div>
    </nav>
  );
}
