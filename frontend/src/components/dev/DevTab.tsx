import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getDevInfo } from '../../api';
import type { DevInfo } from '../../api';
import DatabaseSync from './DatabaseSync';

// How long the server has been up, e.g. "2d 3h 14m"
const uptimeText = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-slate-800 last:border-b-0 text-xs">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className="text-white text-right break-all">{value}</span>
    </div>
  );
}

// The DEV menu (DEV accounts only; the server checks): the running server and its database
export default function DevTab() {
  const [info, setInfo] = useState<DevInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchInfo = () => getDevInfo()
    .then(data => { setInfo(data); setError(''); })
    .catch(err => setError(err instanceof Error ? err.message : 'Failed to load the DEV information.'))
    .finally(() => setLoading(false));

  const load = () => {
    setLoading(true);
    fetchInfo();
  };

  useEffect(() => { fetchInfo(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-lg font-bold text-white">DEV</h2>
        <button type="button" onClick={load} disabled={loading} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 px-3 py-1.5 rounded font-semibold text-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!error && !info && <p className="text-xs text-slate-500">Loading…</p>}
      {info && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl">
            <h3 className="font-semibold text-white mb-3">Server</h3>
            <Row label="Host" value={info.server.hostname} />
            <Row label="Platform" value={info.server.platform} />
            <Row label="Node.js" value={info.server.node} />
            <Row label="Environment" value={info.server.environment} />
            <Row label="Up for" value={uptimeText(info.server.uptimeSeconds)} />
            <Row label="Started" value={new Date(info.server.startedAt).toLocaleString()} />
            <Row label="Memory" value={`${info.server.memoryMb} MB`} />
            <Row label="Active sessions" value={info.activeSessions} />
          </section>
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl">
            <h3 className="font-semibold text-white mb-3">Database</h3>
            <Row label="Name" value={info.database.name} />
            <Row label="Size" value={info.database.size} />
            <Row label="Server time" value={new Date(info.database.now).toLocaleString()} />
            <Row label="Version" value={info.database.version.split(',')[0]} />
            <Row label="Migrations applied" value={info.database.migrationCount} />
          </section>
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl">
            <h3 className="font-semibold text-white mb-3">Latest Migrations</h3>
            {info.database.recentMigrations.map(m => (
              <Row key={m.name} label={m.name} value={new Date(m.appliedon).toLocaleString()} />
            ))}
          </section>
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl">
            <h3 className="font-semibold text-white mb-3">Active Accounts</h3>
            {info.activeAccountsByRole.map(r => <Row key={r.role} label={r.role} value={r.n} />)}
          </section>
          <DatabaseSync />
        </div>
      )}
    </div>
  );
}
