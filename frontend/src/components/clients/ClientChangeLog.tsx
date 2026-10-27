import { useEffect, useState } from 'react';
import { getClientChangeLog } from '../../api';
import type { ClientChange } from '../../api';
import { CHANGE_LOG_TYPES } from '../../utils/clients';
import { formatLogMonthDay, formatLogTime, formatLogYear } from '../../utils/dates';

interface Props {
  clientId: number;
  userEmail: string;
}

const labelFor = (type: string) => CHANGE_LOG_TYPES.find(t => t.type === type)?.label || type;

// The Change Log tab of a client's account (Business Administrators only; the server checks the role). Loaded each
// time it is shown, so it includes changes made since the account was opened.
export default function ClientChangeLog({ clientId, userEmail }: Props) {
  const [changes, setChanges] = useState<ClientChange[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState('');
  // Bumped by Retry to load again
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getClientChangeLog(clientId, userEmail)
      .then(list => { if (!cancelled) { setChanges(list); setStatus('ready'); } })
      .catch(() => { if (!cancelled) { setChanges([]); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [clientId, userEmail, attempt]);

  const retry = () => {
    setStatus('loading');
    setAttempt(n => n + 1);
  };

  const shown = changes.filter(c => !filter || c.changetype === filter);

  return (
    <div className="space-y-3">
      {/* One filter per change type; counts reflect the whole log */}
      <div className="flex flex-wrap gap-2">
        {[{ type: '', label: 'All' }, ...CHANGE_LOG_TYPES].map(({ type, label }) => {
          const count = type ? changes.filter(c => c.changetype === type).length : changes.length;
          const active = filter === type;
          return (
            <button
              key={type || 'all'}
              type="button"
              onClick={() => setFilter(type)}
              className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${active ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
            >
              {label} <span className="text-slate-500">({count})</span>
            </button>
          );
        })}
      </div>

      {status === 'loading' ? (
        <p className="text-sm text-slate-500">Loading change log...</p>
      ) : status === 'error' ? (
        <button type="button" onClick={retry} className="text-sm text-blue-400 hover:underline">Could not load the change log. Retry</button>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-xl p-6 text-center">
          {filter ? `No ${labelFor(filter)} changes recorded.` : 'No changes recorded for this client yet.'}
        </p>
      ) : shown.map((c, i) => (
        <div key={c.changeid ?? `expired-${i}`} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex gap-5">
          <div className="shrink-0 w-28 flex flex-col justify-center border-r border-slate-800 pr-5">
            <p className="text-2xl font-bold text-white leading-tight">{formatLogMonthDay(c.changedon)}</p>
            <p className="text-sm text-slate-400 mt-0.5">{formatLogYear(c.changedon)}</p>
            <p className="text-xs text-slate-500 mt-1">{formatLogTime(c.changedon)}</p>
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <span className="text-xs text-blue-400 font-semibold">{labelFor(c.changetype)}</span>
            {(c.oldvalue || c.newvalue) && (
              <p className="text-slate-200">
                {c.oldvalue && <><span className="text-slate-400 line-through">{c.oldvalue}</span><span className="text-slate-500"> → </span></>}
                <span className="font-semibold text-white">{c.newvalue}</span>
              </p>
            )}
            {c.details && <p className="text-xs text-slate-400">{c.details}</p>}
            <p className="text-xs text-slate-500 text-right">— {c.changedby}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
