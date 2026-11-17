import { useCallback, useEffect, useState } from 'react';
import { Code2, RefreshCw } from 'lucide-react';
import { getDevInfo, getDevices } from '../../api';
import type { DevInfo } from '../../api';
import { uptimeText } from '../../utils/dates';

interface Props {
  // Opens the DEV tab, where each of these can be acted on
  onOpenDev: () => void;
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function Tile({ label, value, detail, warn }: { label: string; value: React.ReactNode; detail?: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.625rem] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <p className={`text-lg font-bold mt-0.5 truncate ${warn ? 'text-amber-400' : 'text-white'}`}>{value}</p>
      {detail && <p className="text-[0.625rem] text-slate-500 truncate" title={detail}>{detail}</p>}
    </div>
  );
}

// DEV accounts only (the server checks): the server and database at a glance on the Home page, so a problem shows
// at login without opening the DEV tab
export default function DevHealth({ onOpenDev }: Props) {
  const [info, setInfo] = useState<DevInfo | null>(null);
  const [pendingDevices, setPendingDevices] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Loads both; each part shows on its own if the other fails. isCurrent stops a late answer after the page is left.
  const fetchAll = useCallback((isCurrent: () => boolean = () => true) =>
    Promise.allSettled([getDevInfo(), getDevices()]).then(([infoResult, devicesResult]) => {
      if (!isCurrent()) return;
      if (infoResult.status === 'fulfilled') { setInfo(infoResult.value); setError(''); }
      else setError(errorText(infoResult.reason, 'The server information could not be loaded.'));
      setPendingDevices(devicesResult.status === 'fulfilled' ? devicesResult.value.filter(d => d.status === 'pending').length : null);
      setLoading(false);
    }), []);

  const load = () => {
    setLoading(true);
    fetchAll();
  };

  useEffect(() => {
    let cancelled = false;
    fetchAll(() => !cancelled);
    return () => { cancelled = true; };
  }, [fetchAll]);

  const pendingMigrations = info?.database.pendingMigrations ?? [];

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <button type="button" onClick={onOpenDev} className="flex items-center gap-2 text-blue-400 hover:text-blue-300" title="Open the DEV tab">
          <Code2 size={16} />
          <span className="font-semibold text-white text-sm">System Health</span>
        </button>
        <button type="button" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh"
          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {error && <p className="text-xs text-red-400">Server problem: {error}</p>}
      {!error && !info && <p className="text-xs text-slate-500">Loading…</p>}
      {info && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Tile label="Server" value={<span className="text-emerald-400">Running</span>} detail={`${info.server.hostname} · up ${uptimeText(info.server.uptimeSeconds)}`} />
          <Tile label="Database" value={info.database.name} detail={info.database.size} />
          <Tile label="Migrations Pending" value={pendingMigrations.length} warn={pendingMigrations.length > 0}
            detail={pendingMigrations.length ? `${pendingMigrations.join(', ')}: run on next restart` : `${info.database.migrationCount} applied`} />
          <Tile label="Devices Waiting" value={pendingDevices ?? '—'} warn={!!pendingDevices}
            detail={pendingDevices === null ? 'Could not load devices' : pendingDevices ? 'Approve on the DEV tab' : 'None waiting'} />
          <Tile label="Signed In Now" value={info.activeSessions} detail={`${info.server.memoryMb} MB memory`} />
        </div>
      )}
    </section>
  );
}
