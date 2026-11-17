import { useEffect, useState } from 'react';
import { getClientDischarges } from '../../api';
import type { ClientDischarge } from '../../api';
import { formatLogTime, parseLogDate } from '../../utils/dates';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import { dischargeCountText } from '../../utils/clients';

interface Props {
  clientId: number;
}

const day = (value: string) => parseLogDate(value)?.toLocaleDateString() ?? value;

// Discharge History on a client's Information tab: how many times the client has been discharged and each discharge
// (newest first). Every discharge is kept, also after the client is activated again, including ones from the old system.
// App remounts it after a Discharge or Activate so it shows the new discharge.
export default function DischargeHistoryPanel({ clientId }: Props) {
  const employeeLabel = useEmployeeLabel();
  const [discharges, setDischarges] = useState<ClientDischarge[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Bumped by Retry to load again
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getClientDischarges(clientId)
      .then(list => { if (!cancelled) { setDischarges(list); setStatus('ready'); } })
      .catch(() => { if (!cancelled) { setDischarges([]); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [clientId, attempt]);

  const retry = () => {
    setStatus('loading');
    setAttempt(n => n + 1);
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
      <div className="flex justify-between items-baseline gap-3 mb-3">
        <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Discharge History</h3>
        {status === 'ready' && (
          <p className={`text-sm font-semibold ${discharges.length > 0 ? 'text-white' : 'text-slate-400'}`}>{dischargeCountText(discharges.length)}</p>
        )}
      </div>

      {status === 'loading' ? (
        <p className="text-xs text-slate-500">Loading discharge history...</p>
      ) : status === 'error' ? (
        <button type="button" onClick={retry} className="text-xs text-blue-400 hover:underline">Could not load the discharge history. Retry</button>
      ) : discharges.length === 0 ? (
        <p className="text-xs text-slate-400">This client has never been discharged.</p>
      ) : (
        <ul className="space-y-2">
          {discharges.map(d => (
            <li key={d.dischargeid} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm">
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                <p className="text-white font-semibold">
                  {d.dischargetype}
                  {d.subcategory && <span className="text-slate-400 font-normal">: {d.subcategory}</span>}
                </p>
                <p className="text-xs text-slate-400">
                  {day(d.dischargedon)} {formatLogTime(d.dischargedon)}
                  {d.dischargedby && <> · {employeeLabel(d.dischargedby)}</>}
                </p>
              </div>
              {d.note && <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{d.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
