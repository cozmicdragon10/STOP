import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Columns3, GripVertical, Lock, RotateCcw } from 'lucide-react';
import type { useColumnLayout } from '../hooks/useColumnLayout';

interface Props<K extends string> {
  layout: ReturnType<typeof useColumnLayout<K>>;
  labels: Record<K, string>;
}

// "Columns" button and panel: tick columns on or off, and drag (or use the arrows) to reorder them
export default function ColumnPicker<K extends string>({ layout, labels }: Props<K>) {
  const [open, setOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
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

  const hiddenCount = layout.order.length - layout.visibleKeys.length;
  const arrow = 'p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none';

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${open || !layout.isDefault ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
      >
        <Columns3 size={13} /> Columns
        {hiddenCount > 0 && <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{hiddenCount} off</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-2">
          <p className="px-1 pb-2 text-[11px] text-slate-400">Tick to show a column. Drag or use the arrows to change the order.</p>
          <ul className="space-y-0.5">
            {layout.order.map((key, i) => (
              <li
                key={key}
                draggable
                onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); setOverIndex(i); }}
                onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) layout.move(dragIndex, i); setDragIndex(null); setOverIndex(null); }}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                className={`flex items-center gap-1.5 px-1 py-1 rounded text-xs ${dragIndex === i ? 'opacity-40' : ''} ${overIndex === i && dragIndex !== null && dragIndex !== i ? 'bg-blue-500/15 ring-1 ring-blue-500/40' : 'hover:bg-slate-800'}`}
              >
                <GripVertical size={13} className="shrink-0 text-slate-500 cursor-grab" />
                <label className={`flex-1 flex items-center gap-2 min-w-0 ${layout.isLocked(key) ? 'text-slate-300' : 'text-slate-200 cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={layout.isVisible(key)}
                    disabled={layout.isLocked(key)}
                    onChange={() => layout.toggle(key)}
                    className="accent-blue-500"
                  />
                  <span className="truncate">{labels[key]}</span>
                  {layout.isLocked(key) && <Lock size={10} className="shrink-0 text-slate-500" aria-label="Always shown" />}
                </label>
                <button type="button" onClick={() => layout.move(i, i - 1)} disabled={i === 0} title={`Move ${labels[key]} left`} className={arrow}><ArrowUp size={12} /></button>
                <button type="button" onClick={() => layout.move(i, i + 1)} disabled={i === layout.order.length - 1} title={`Move ${labels[key]} right`} className={arrow}><ArrowDown size={12} /></button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={layout.reset}
            disabled={layout.isDefault}
            className="w-full mt-2 flex items-center justify-center gap-1.5 border-t border-slate-800 pt-2 pb-1 text-xs text-slate-400 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
          >
            <RotateCcw size={12} /> Reset to default columns
          </button>
        </div>
      )}
    </div>
  );
}
