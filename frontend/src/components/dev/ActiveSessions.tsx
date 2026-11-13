import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { endDevSession, getDevSessions } from '../../api';
import type { DevSession } from '../../api';

// "13 Nov 2026, 2:05 PM" style, in the browser's time zone
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Logins that have not expired (DEV only; the server checks). Ending one signs that login out on its next request.
export default function ActiveSessions() {
  const [sessions, setSessions] = useState<DevSession[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'load' | string>('load');
  const [message, setMessage] = useState('');

  const fetchSessions = () => getDevSessions()
    .then(list => { setSessions(list); setError(''); })
    .catch(err => setError(err instanceof Error ? err.message : 'Failed to load the active sessions.'))
    .finally(() => setBusy(''));

  const load = () => {
    setBusy('load');
    fetchSessions();
  };

  useEffect(() => { fetchSessions(); }, []);

  const end = async (session: DevSession) => {
    const name = session.displayName || session.email;
    if (!window.confirm(`Sign out ${name} (${session.email}) on this login? They will have to log in again.`)) return;
    setBusy(session.sessionHash);
    setError('');
    setMessage('');
    try {
      await endDevSession(session.sessionHash);
      setMessage(`Signed out ${session.email}.`);
      await fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end the session.');
    } finally {
      setBusy('');
    }
  };

  const working = busy !== '';

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl lg:col-span-2">
      <div className="flex justify-between items-center gap-3 mb-3">
        <h3 className="font-semibold text-white">Active Sessions</h3>
        <button type="button" onClick={load} disabled={working} className="flex items-center gap-1.5 text-slate-400 hover:text-white disabled:opacity-50 text-xs">
          <RefreshCw size={12} className={busy === 'load' ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {sessions && sessions.length === 0 && <p className="text-xs text-slate-500">No one is logged in.</p>}
      {sessions && sessions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="py-2 pr-3 font-medium">Employee</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Logged in</th>
                <th className="py-2 pr-3 font-medium">Expires</th>
                <th className="py-2 font-medium text-right">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.sessionHash} className="border-b border-slate-800 last:border-b-0 text-white">
                  <td className="py-2 pr-3">
                    <div>{s.displayName || s.email}</div>
                    <div className="text-slate-500 break-all">{s.email}</div>
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{s.role ?? '-'}</td>
                  <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{when(s.createdOn)}</td>
                  <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{when(s.expiresOn)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {s.current ? (
                      <span className="text-slate-500">This session</span>
                    ) : (
                      <button type="button" onClick={() => end(s)} disabled={working} className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded font-semibold">
                        {busy === s.sessionHash ? 'Ending…' : 'End session'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message && <p className="text-xs text-green-400 mt-3">{message}</p>}
      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
    </section>
  );
}
