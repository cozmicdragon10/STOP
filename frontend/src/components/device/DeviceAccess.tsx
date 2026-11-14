import { useEffect, useState } from 'react';
import { AlertCircle, Clock, KeyRound, ShieldAlert } from 'lucide-react';
import { getDeviceStatus, redeemSetupCode, requestDeviceAccess } from '../../api';
import type { DeviceState } from '../../api';
import { DEVICE_NAME_MAX, DEVICE_NOTE_MAX, accessRequestError, deviceScreen } from '../../utils/deviceAccess';

const CHECK_EVERY_MS = 30_000;

const inputClass = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm';
const labelClass = 'block text-xs font-semibold text-slate-300 uppercase mb-1';
const buttonClass = 'w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition text-sm shadow-lg shadow-blue-600/30';

// Shown instead of the login screen until this browser is an approved device (backend/lib/devices.js)
export default function DeviceAccess({ state, onState }: { state: DeviceState; onState: (state: DeviceState) => void }) {
  const screen = deviceScreen(state);
  const [mode, setMode] = useState<'request' | 'code'>('request');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = async () => {
    try {
      onState(await getDeviceStatus());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check this device.');
    }
  };

  // While waiting, check now and then so the login appears soon after approval
  useEffect(() => {
    if (screen !== 'waiting') return;
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = accessRequestError({ name, email, note });
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      onState((await requestDeviceAccess({ name: name.trim(), email: email.trim(), note: note.trim() })).state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onState((await redeemSetupCode(code)).state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that setup code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 sm:p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white tracking-wide">STOP System</h1>
          <p className="text-slate-400 text-sm mt-1">Chandler & Associates Management</p>
        </div>
        {error && <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg mb-4 text-sm flex items-center gap-2"><AlertCircle size={18} className="shrink-0" /> {error}</div>}

        {screen === 'waiting' && (
          <div className="text-center space-y-4">
            <Clock size={36} className="mx-auto text-blue-400" />
            <h2 className="text-white font-semibold">Waiting for approval</h2>
            <p className="text-slate-400 text-sm">Your request was sent. The login will appear here once the office approves this device. Requests not reviewed within 24 hours expire, and you can send a new one.</p>
            <button type="button" onClick={check} className={buttonClass}>Check again</button>
          </div>
        )}

        {(screen === 'denied' || screen === 'revoked') && (
          <div className="text-center space-y-3">
            <ShieldAlert size={36} className="mx-auto text-red-400" />
            <h2 className="text-white font-semibold">{screen === 'denied' ? 'This device was not approved' : 'This device can no longer use STOP'}</h2>
            <p className="text-slate-400 text-sm">Contact the office if you need access from this device.</p>
          </div>
        )}

        {screen === 'request' && mode === 'request' && (
          <form onSubmit={submitRequest} className="space-y-4">
            <div>
              <h2 className="text-white font-semibold">Request access for this device</h2>
              <p className="text-slate-400 text-xs mt-1">{state === 'expired' ? 'Your last request expired before it was reviewed. Send a new one below.' : 'This device has to be approved before you can log in. Use the email on your STOP account.'}</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="device-name">Your name</label>
              <input id="device-name" value={name} onChange={e => setName(e.target.value)} maxLength={DEVICE_NAME_MAX} autoComplete="name" className={inputClass} required />
            </div>
            <div>
              <label className={labelClass} htmlFor="device-email">Employee email</label>
              <input id="device-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" className={inputClass} required />
            </div>
            <div>
              <label className={labelClass} htmlFor="device-note">Note for the office (optional)</label>
              <textarea id="device-note" value={note} onChange={e => setNote(e.target.value)} maxLength={DEVICE_NOTE_MAX} rows={3}
                placeholder="Which device this is and why you need it, e.g. home desktop, left my laptop at the office"
                className={`${inputClass} resize-none`} />
              <p className="text-right text-[11px] text-slate-500 mt-1">{note.length}/{DEVICE_NOTE_MAX}</p>
            </div>
            <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Sending…' : 'Request access'}</button>
            <button type="button" onClick={() => { setMode('code'); setError(''); }} className="w-full text-xs text-blue-400 hover:text-blue-300 flex items-center justify-center gap-1.5">
              <KeyRound size={12} /> I have a setup code
            </button>
          </form>
        )}

        {screen === 'request' && mode === 'code' && (
          <form onSubmit={submitCode} className="space-y-4">
            <div>
              <h2 className="text-white font-semibold">Enter a setup code</h2>
              <p className="text-slate-400 text-xs mt-1">A setup code comes from the server console and works once.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="device-code">Setup code</label>
              <input id="device-code" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXXX-XXXXX" autoComplete="off" spellCheck={false}
                className={`${inputClass} uppercase tracking-widest font-mono`} required />
            </div>
            <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Checking…' : 'Use setup code'}</button>
            <button type="button" onClick={() => { setMode('request'); setError(''); }} className="w-full text-xs text-blue-400 hover:text-blue-300">Back to the request form</button>
          </form>
        )}
      </div>
    </div>
  );
}
