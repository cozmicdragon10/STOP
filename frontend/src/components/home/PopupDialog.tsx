import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import ScrollLock from '../ScrollLock';

interface Props {
  // Heading text and the line under it
  title: string;
  subtitle?: string;
  // While saving, Escape and clicking outside don't close it
  busy?: boolean;
  // false: a click outside the box doesn't close it (forms that would lose what was typed); X and Escape still do
  closeOnOutsideClick?: boolean;
  onClose: () => void;
  children: ReactNode;
}

// A centered pop-up over a dimmed page, like the app's other dialogs (BusPassDialog). Escape or a click outside closes
// it. Content isn't clipped, so a client search list can hang below its box.
export default function PopupDialog({ title, subtitle, busy = false, closeOnOutsideClick = true, onClose, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // The latest close handler and busy flag, read by the Escape key listener
  const latest = useRef({ busy, onClose });
  useEffect(() => { latest.current = { busy, onClose }; });

  // Focus the dialog once when it opens (not on later renders, which would pull focus out of a field)
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !latest.current.busy) latest.current.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    // z-[60]: above the client account panel (z-50), which a call-in dialog opens over. A box taller than the window
    // scrolls with the page (m-auto centers it when it fits) instead of being cut off.
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex overflow-y-auto z-[60] p-4" onClick={() => { if (!busy && closeOnOutsideClick) onClose(); }}>
      <ScrollLock />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className="m-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4 focus:outline-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={titleId} className="text-lg font-bold text-white">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
