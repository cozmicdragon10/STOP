import { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import type { ClientRecord } from '../../hooks/useGroupCheckIn';

interface Props {
  clients: ClientRecord[];
  checkedInIds: Set<number>;
  onAdd: (clients: ClientRecord[]) => void;
  onClose: () => void;
}

const MAX_RESULTS = 50;

// Selection here is local to the modal. Adding clients never touches the roster selection.
export default function ClientSearchModal({ clients, checkedInIds, onAdd, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      `${c.lastname}, ${c.firstname} ${c.docnumber ?? ''}`.toLowerCase().includes(q)
    );
  }, [clients, query]);

  const visible = matches.slice(0, MAX_RESULTS);

  const togglePick = (clientId: number) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  const handleAdd = () => {
    onAdd(clients.filter(c => picked.has(c.clientid)));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="client-search-title"
        className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <header className="flex justify-between items-center p-5 border-b border-slate-800">
          <div>
            <h3 id="client-search-title" className="font-semibold text-white">Check In Client From Another Group</h3>
            <p className="text-xs text-slate-400 mt-0.5">Search any client. They are added to this session only.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800" aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or DOC #"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-white text-sm"
            />
          </div>

          <p className="text-xs text-slate-500">
            {matches.length > MAX_RESULTS ? `Showing ${MAX_RESULTS} of ${matches.length} matches. Refine your search.` : `${matches.length} match(es)`}
          </p>

          <ul className="overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg min-h-[8rem]">
            {visible.length === 0 && (
              <li className="p-4 text-sm text-slate-500 text-center">No clients match that search.</li>
            )}
            {visible.map(c => {
              const onSheet = checkedInIds.has(c.clientid);
              return (
                <li key={c.clientid}>
                  <label className={`flex items-center gap-3 p-3 text-sm ${onSheet ? 'opacity-50' : 'cursor-pointer hover:bg-slate-800/50'}`}>
                    <input
                      type="checkbox"
                      disabled={onSheet}
                      checked={onSheet || picked.has(c.clientid)}
                      onChange={() => togglePick(c.clientid)}
                      className="accent-blue-500"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-white truncate">{c.lastname}, {c.firstname}</p>
                      <p className="text-xs text-slate-400 truncate">DOC # {c.docnumber || '—'} · {c.groupname || 'Unassigned'}</p>
                    </div>
                    {onSheet && <span className="text-[10px] font-semibold uppercase text-emerald-400">On sheet</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="p-5 border-t border-slate-800 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={picked.size === 0}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <UserPlus size={14} /> Add {picked.size > 0 ? picked.size : ''} to Sheet
          </button>
        </footer>
      </div>
    </div>
  );
}
