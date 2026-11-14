import { useEffect, useState } from 'react';
import { Check, Pencil, RefreshCw, X } from 'lucide-react';
import { approveDevice, denyDevice, getDevices, renameDevice, revokeDevice } from '../../api';
import type { DeviceRow } from '../../api';
import { DEVICE_MEMO_MAX, DEVICE_NAME_MAX, describeUserAgent } from '../../utils/deviceAccess';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const STATUS_LABEL: Record<string, string> = { denied: 'Denied', revoked: 'Removed', expired: 'Expired', pending: 'Pending', approved: 'Approved' };
const inputClass = 'w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500';

// One pending request: who asked, from where, their note, and the owner's memo for the decision
function PendingRequest({ device, busy, onDecide }: {
  device: DeviceRow;
  busy: boolean;
  onDecide: (device: DeviceRow, approve: boolean, memo: string, name: string) => void;
}) {
  const [memo, setMemo] = useState('');
  const [name, setName] = useState(device.name);
  return (
    <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 space-y-2 text-xs">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <div className="text-white font-semibold">{device.requestName || device.name}</div>
          <div className="text-slate-400 break-all">{device.requestEmail}{device.requestRole ? ` · ${device.requestRole}` : ''}</div>
        </div>
        <div className="text-slate-400 text-right">
          <div>Requested {when(device.requestedOn)}</div>
          <div>Expires {when(device.expiresOn)}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-slate-300">
        <div><span className="text-slate-500">IP:</span> {device.firstIp || '-'}</div>
        <div><span className="text-slate-500">Browser:</span> <span title={device.userAgent ?? ''}>{describeUserAgent(device.userAgent)}</span></div>
      </div>
      <div className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 whitespace-pre-wrap break-words">
        {device.requestNote || <span className="text-slate-500">No note.</span>}
      </div>
      <div>
        <label className="block text-slate-400 mb-1" htmlFor={`device-name-${device.deviceId}`}>Device name</label>
        <input id={`device-name-${device.deviceId}`} value={name} onChange={e => setName(e.target.value)} maxLength={DEVICE_NAME_MAX} className={inputClass} />
      </div>
      <div>
        <label className="block text-slate-400 mb-1" htmlFor={`device-memo-${device.deviceId}`}>Approval memo</label>
        <textarea id={`device-memo-${device.deviceId}`} value={memo} onChange={e => setMemo(e.target.value)} maxLength={DEVICE_MEMO_MAX} rows={2}
          placeholder="e.g. Confirmed by phone with Jane, home desktop" className={`${inputClass} resize-none`} />
        <div className="text-right text-[11px] text-slate-500">{memo.length}/{DEVICE_MEMO_MAX}</div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={() => onDecide(device, false, memo, name)}
          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-red-300 border border-slate-700 px-2.5 py-1 rounded font-semibold">
          <X size={12} /> Deny
        </button>
        <button type="button" disabled={busy} onClick={() => onDecide(device, true, memo, name)}
          className="flex items-center gap-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-2.5 py-1 rounded font-semibold">
          <Check size={12} /> Approve
        </button>
      </div>
    </div>
  );
}

// Requests to use STOP from a new device, the approved devices, and past decisions (DEV only; the server checks)
export default function DeviceApprovals() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<number | 'load' | null>('load');
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [showPast, setShowPast] = useState(false);

  const fetchDevices = () => getDevices()
    .then(list => { setDevices(list); setError(''); })
    .catch(err => setError(err instanceof Error ? err.message : 'Failed to load the devices.'))
    .finally(() => setBusy(null));

  useEffect(() => { fetchDevices(); }, []);

  // Runs an action, then reloads the list. Resolves true when the action worked.
  const run = async (id: number | 'load', action: () => Promise<unknown>, done: string) => {
    setBusy(id);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(done);
      await fetchDevices();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
      setBusy(null);
      return false;
    }
  };

  const decide = (device: DeviceRow, approve: boolean, memo: string, name: string) => {
    const who = device.requestName || device.name;
    if (!approve && !window.confirm(`Deny the request from ${who}? They will not be able to use STOP from that device.`)) return;
    run(device.deviceId,
      () => (approve ? approveDevice(device.deviceId, memo.trim(), name.trim() || undefined) : denyDevice(device.deviceId, memo.trim())),
      approve ? `Approved ${name.trim() || who}.` : `Denied the request from ${who}.`);
  };

  const revoke = (device: DeviceRow) => {
    if (!window.confirm(`Remove ${device.name}? It will be signed out and will have to request access again.`)) return;
    run(device.deviceId, () => revokeDevice(device.deviceId), `Removed ${device.name}.`);
  };

  const saveName = () => {
    if (!renaming) return;
    const { id, name } = renaming;
    if (!name.trim()) return setError('A device needs a name.');
    run(id, () => renameDevice(id, name.trim()), `Renamed to ${name.trim()}.`).then(ok => { if (ok) setRenaming(null); });
  };

  const pending = devices?.filter(d => d.status === 'pending') ?? [];
  const approved = devices?.filter(d => d.status === 'approved') ?? [];
  const past = devices?.filter(d => d.status !== 'pending' && d.status !== 'approved') ?? [];
  const working = busy !== null;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl lg:col-span-2 space-y-5">
      <div className="flex justify-between items-center gap-3">
        <h3 className="font-semibold text-white">Devices</h3>
        <button type="button" onClick={() => { setBusy('load'); fetchDevices(); }} disabled={working} className="flex items-center gap-1.5 text-slate-400 hover:text-white disabled:opacity-50 text-xs">
          <RefreshCw size={12} className={busy === 'load' ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-300 uppercase mb-2">Waiting for approval ({pending.length})</h4>
        {devices && pending.length === 0 && <p className="text-xs text-slate-500">No requests are waiting.</p>}
        <div className="space-y-3">
          {pending.map(d => <PendingRequest key={d.deviceId} device={d} busy={working} onDecide={decide} />)}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-300 uppercase mb-2">Approved devices ({approved.length})</h4>
        {devices && approved.length === 0 && <p className="text-xs text-slate-500">No devices are approved.</p>}
        {approved.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-3 font-medium">Device</th>
                  <th className="py-2 pr-3 font-medium">Requested by</th>
                  <th className="py-2 pr-3 font-medium">Last IP</th>
                  <th className="py-2 pr-3 font-medium">Last seen</th>
                  <th className="py-2 pr-3 font-medium">Approval memo</th>
                  <th className="py-2 font-medium text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {approved.map(d => (
                  <tr key={d.deviceId} className="border-b border-slate-800 last:border-b-0 text-white align-top">
                    <td className="py-2 pr-3 min-w-[10rem]">
                      {renaming?.id === d.deviceId ? (
                        <div className="flex gap-1">
                          <input value={renaming.name} onChange={e => setRenaming({ id: d.deviceId, name: e.target.value })} maxLength={DEVICE_NAME_MAX}
                            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(null); }}
                            className={inputClass} autoFocus aria-label="Device name" />
                          <button type="button" onClick={saveName} disabled={working} className="text-green-400 hover:text-green-300 px-1" aria-label="Save name"><Check size={14} /></button>
                          <button type="button" onClick={() => setRenaming(null)} className="text-slate-400 hover:text-white px-1" aria-label="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span>{d.name}</span>
                          <button type="button" onClick={() => setRenaming({ id: d.deviceId, name: d.name })} className="text-slate-500 hover:text-white" aria-label={`Rename ${d.name}`}><Pencil size={12} /></button>
                        </div>
                      )}
                      <div className="text-slate-500" title={d.userAgent ?? ''}>{describeUserAgent(d.userAgent)}{d.current ? ' · this device' : ''}</div>
                    </td>
                    <td className="py-2 pr-3 text-slate-300 break-all">{d.requestEmail || d.requestName || '-'}</td>
                    <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">
                      <div>{d.lastIp || '-'}</div>
                      {d.firstIp && d.firstIp !== d.lastIp && <div className="text-slate-500">first {d.firstIp}</div>}
                    </td>
                    <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{when(d.lastSeenOn)}</td>
                    <td className="py-2 pr-3 text-slate-300 whitespace-pre-wrap break-words max-w-[16rem]">
                      {d.approvalMemo || <span className="text-slate-500">-</span>}
                      <div className="text-slate-500">{d.decidedBy ? `by ${d.decidedBy}, ` : ''}{when(d.decidedOn)}</div>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {d.current ? (
                        <span className="text-slate-500">This device</span>
                      ) : (
                        <button type="button" onClick={() => revoke(d)} disabled={working} className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded font-semibold">
                          {busy === d.deviceId ? 'Removing…' : 'Remove'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {past.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowPast(v => !v)} className="text-xs font-semibold text-slate-400 hover:text-white uppercase">
            {showPast ? 'Hide' : 'Show'} past requests ({past.length})
          </button>
          {showPast && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Device</th>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">IP</th>
                    <th className="py-2 pr-3 font-medium">Requested</th>
                    <th className="py-2 font-medium">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map(d => (
                    <tr key={d.deviceId} className="border-b border-slate-800 last:border-b-0 text-slate-300 align-top">
                      <td className="py-2 pr-3">{STATUS_LABEL[d.status] ?? d.status}</td>
                      <td className="py-2 pr-3">{d.name}<div className="text-slate-500">{describeUserAgent(d.userAgent)}</div></td>
                      <td className="py-2 pr-3 break-all">{d.requestEmail || '-'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{d.lastIp || d.firstIp || '-'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{when(d.requestedOn)}</td>
                      <td className="py-2 whitespace-pre-wrap break-words">{d.approvalMemo || d.requestNote || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {message && <p className="text-xs text-green-400">{message}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
