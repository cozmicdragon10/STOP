import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from 'lucide-react';
import { getDevSyncStatus, runDevSync } from '../../api';
import type { DevDatabase, DevSyncStatus } from '../../api';

function DatabaseCard({ title, db }: { title: string; db: DevDatabase }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1 border-b border-slate-800 last:border-b-0 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-white text-right break-all">{value}</span>
    </div>
  );
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex-1 min-w-0">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="font-semibold text-white mb-2">{db.name}</p>
      {!db.exists ? (
        <p className="text-xs text-slate-500">Does not exist yet. Pull to create it.</p>
      ) : (
        <>
          {row('Size', db.size)}
          {row('Tables', db.tables)}
          {row('Views', db.views)}
          {row('Rows (approx.)', db.rows?.toLocaleString())}
          {row('Migrations', db.migrations?.count)}
          {row('Latest migration', db.migrations?.latest ?? '-')}
        </>
      )}
    </div>
  );
}

// DEV only (the server checks): copies the whole database, schema, data and views, between the app database and the
// dev copy. Pull replaces the dev copy; push replaces the app database after the server backs it up.
export default function DatabaseSync() {
  const [status, setStatus] = useState<DevSyncStatus | null>(null);
  const [busy, setBusy] = useState<'' | 'load' | 'pull' | 'push'>('load');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const fetchStatus = () => getDevSyncStatus()
    .then(s => { setStatus(s); setError(''); })
    .catch(err => setError(err instanceof Error ? err.message : 'Failed to load the sync status.'))
    .finally(() => setBusy(''));

  const load = () => {
    setBusy('load');
    fetchStatus();
  };

  useEffect(() => { fetchStatus(); }, []);

  const sync = async (direction: 'pull' | 'push') => {
    if (!status) return;
    const question = direction === 'pull'
      ? `Replace ${status.dev.name} with a fresh copy of ${status.app.name}? Anything only in ${status.dev.name} is lost.`
      : `Replace the LIVE database ${status.app.name} with ${status.dev.name}? Everything entered in the app since your last pull is lost (a backup is taken first), and anyone who logged in since then is logged out.`;
    if (!window.confirm(question)) return;
    setBusy(direction);
    setError('');
    setMessage('');
    try {
      const result = await runDevSync(direction, direction === 'push' ? confirmText : undefined);
      setStatus(result.status);
      setConfirmText('');
      setMessage(`Copied ${result.from} over ${result.to} in ${result.seconds}s.${result.backupFile ? ` Backup: ${result.backupFile}` : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `The ${direction} failed.`);
    } finally {
      setBusy('');
    }
  };

  const working = busy !== '';
  const canPush = !!status?.dev.exists && confirmText === status.app.name;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl lg:col-span-2">
      <div className="flex justify-between items-center gap-3 mb-1">
        <h3 className="font-semibold text-white">Database Sync</h3>
        <button type="button" onClick={load} disabled={working} className="flex items-center gap-1.5 text-slate-400 hover:text-white disabled:opacity-50 text-xs">
          <RefreshCw size={12} className={busy === 'load' ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Copies the whole database (tables, data, views, sequences) from one side to the other, replacing the target completely.
      </p>
      {status && (
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <DatabaseCard title="App database (live)" db={status.app} />
          <DatabaseCard title="Local copy" db={status.dev} />
        </div>
      )}
      {status && (
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
            <p className="text-xs text-slate-300">Pull: copy <b>{status.app.name}</b> over <b>{status.dev.name}</b>. The app database is only read.</p>
            <button type="button" onClick={() => sync('pull')} disabled={working} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded font-semibold text-xs">
              <ArrowDownToLine size={14} className={busy === 'pull' ? 'animate-pulse' : ''} /> {busy === 'pull' ? 'Pulling…' : 'Pull to local'}
            </button>
          </div>
          <div className="flex-1 bg-slate-950 border border-red-900/60 rounded-lg p-3 space-y-2">
            <p className="text-xs text-slate-300">
              Push: replace the live <b>{status.app.name}</b> with <b>{status.dev.name}</b>. It is backed up to the backups folder first.
              Type <b className="text-red-300">{status.app.name}</b> to enable.
            </p>
            <div className="flex gap-2">
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={status.app.name}
                disabled={working || !status.dev.exists}
                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
              />
              <button type="button" onClick={() => sync('push')} disabled={working || !canPush} className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white px-3 py-1.5 rounded font-semibold text-xs">
                <ArrowUpFromLine size={14} className={busy === 'push' ? 'animate-pulse' : ''} /> {busy === 'push' ? 'Pushing…' : 'Push to app'}
              </button>
            </div>
          </div>
        </div>
      )}
      {working && busy !== 'load' && <p className="text-xs text-slate-400 mt-3">Copying… this takes about 15-30 seconds. Keep this page open.</p>}
      {message && <p className="text-xs text-green-400 mt-3 break-all">{message}</p>}
      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
    </section>
  );
}
