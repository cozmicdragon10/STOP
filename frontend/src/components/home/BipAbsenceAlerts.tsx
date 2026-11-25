import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { getBipAbsenceAlerts } from '../../api';
import type { BipAbsenceAlert } from '../../api';

// BIP clients locked from their primary group's check-in by an absence threshold (lib/bipAbsences.js). Shown on the Business
// Administrator home (every counselor's clients) and the counselor home (their own groups' clients). Nothing when none.
export default function BipAbsenceAlerts() {
  const [alerts, setAlerts] = useState<BipAbsenceAlert[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    getBipAbsenceAlerts()
      .then(rows => { if (current) setAlerts(rows); })
      .catch(err => { if (current) setError(err instanceof Error ? err.message : 'Could not load the BIP absence alerts.'); });
    return () => { current = false; };
  }, []);

  if (error) return <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">{error}</p>;
  if (!alerts || alerts.length === 0) return null;

  const day = (ymd: string | null) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  const failed = alerts.filter(a => a.failEligible).length;

  return (
    <section aria-label="BIP absence alerts" className="bg-amber-500/5 border border-amber-500/40 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-2">
        <TriangleAlert size={18} className="text-amber-300 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-amber-200">
            {alerts.length} BIP client{alerts.length === 1 ? '' : 's'} locked from group check-in for absences
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            They can still make up an absence at a different group. {failed > 0 && <span className="text-rose-300">{failed} past the deadline and eligible for Program Failed.</span>}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-slate-800 text-sm">
        {alerts.map(a => (
          <li key={a.clientid} className="py-2 flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="text-white">{a.name}</span>
              <span className="text-xs text-slate-400"> · {a.groupname}{a.counselor ? ` · ${a.counselor}` : ''}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-300">{a.reason === 'streak' ? '3 missed in a row' : `${a.openCount} open absences`}</span>
              {a.deadline && <span className="text-slate-400">make up by {day(a.deadline)}</span>}
              {a.fullLock && <span className="px-2 py-0.5 rounded border bg-rose-500/15 border-rose-500/40 text-rose-200">Locked from all groups</span>}
              {a.failEligible && <span className="px-2 py-0.5 rounded border bg-rose-500/15 border-rose-500/40 text-rose-200">Eligible for Program Failed</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
