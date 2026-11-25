import { useEffect, useState } from 'react';
import { excuseBipAbsence, getBipAbsences, removeBipAbsenceExcuse } from '../../api';
import type { BipAbsence, BipAbsenceStatus } from '../../api';
import PopupDialog from '../home/PopupDialog';

interface Props {
  clientId: number;
  // Business Administrators and DEV can excuse a missed meeting
  canExcuse: boolean;
  // Changes when the client's attendance changes, so the absences are loaded again
  refreshKey: unknown;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const SHOWN = 12;
const longDay = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// The account's BIP absences: how many are open, the current run, any lock and its deadline, and each missed meeting with
// what happened to it. Business Administrators (and DEV) can excuse a missed meeting here (lib/bipAbsences.js).
export default function BipAbsencePanel({ clientId, canExcuse, refreshKey, onSuccess, onError }: Props) {
  const [status, setStatus] = useState<BipAbsenceStatus | null>(null);
  const [excusing, setExcusing] = useState<BipAbsence | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    getBipAbsences(clientId)
      .then(s => { if (current) setStatus(s); })
      .catch(() => { if (current) setStatus(null); });
    return () => { current = false; };
  }, [clientId, refreshKey, reloadKey]);

  if (!status || !status.applies) return null;

  const saveExcuse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excusing || saving) return;
    const text = reason.trim();
    if (!text) return;
    setSaving(true);
    try {
      await excuseBipAbsence(clientId, excusing.date, text);
      onSuccess(`Absence on ${longDay(excusing.date)} excused.`);
      setExcusing(null);
      setReason('');
      setReloadKey(k => k + 1);
    } catch (err) {
      onError(errorText(err, 'Could not excuse the absence.'));
    } finally {
      setSaving(false);
    }
  };

  const undo = async (a: BipAbsence) => {
    try {
      await removeBipAbsenceExcuse(clientId, a.date);
      onSuccess(`The excuse for ${longDay(a.date)} was removed.`);
      setReloadKey(k => k + 1);
    } catch (err) {
      onError(errorText(err, 'Could not remove the excuse.'));
    }
  };

  const lockText = status.fullLock
    ? `Locked from all groups: the week to make up the ${status.lockReason === 'streak' ? '3rd absence in a row' : '7th absence'} has passed.`
    : status.locked
    ? (status.lockReason === 'streak'
      ? 'Locked from their primary group: 3 missed in a row.'
      : 'Locked from their primary group: 7 open absences.')
    : null;
  const shown = showAll ? status.absences : status.absences.slice(0, SHOWN);

  return (
    <section aria-label="BIP absences" className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
      {excusing && (
        <PopupDialog
          title="Excuse this absence"
          subtitle={`Missed ${longDay(excusing.date)}. An excused absence doesn't count toward the limits.`}
          busy={saving}
          onClose={() => setExcusing(null)}>
          <form onSubmit={saveExcuse} className="space-y-3">
            <div>
              <label htmlFor="excuse-reason" className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Reason</label>
              <textarea id="excuse-reason" rows={3} maxLength={500} autoFocus value={reason} onChange={e => setReason(e.target.value)}
                placeholder="Why is this absence excused?" className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm placeholder-slate-500" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setExcusing(null)} disabled={saving} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-1.5 rounded text-xs font-semibold">Close</button>
              <button type="submit" disabled={saving || !reason.trim()} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">
                {saving ? 'Saving...' : 'Excuse Absence'}
              </button>
            </div>
          </form>
        </PopupDialog>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">BIP Absences</h3>
        <p className="text-xs text-slate-400">
          {status.openCount} of 6 open · {status.streak} in a row{status.groupName ? ` · ${status.groupName}` : ''}
        </p>
      </div>
      {lockText && (
        <p className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          {lockText}{' '}
          {status.nextDeadline && !status.fullLock && <>Make up an absence at a different group by {longDay(status.nextDeadline)}.</>}
          {status.failEligible && <strong className="block mt-1 text-rose-300">The deadline has passed: eligible for Program Failed.</strong>}
        </p>
      )}
      {status.absences.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No missed group meetings.</p>
      ) : (
        <ul className="divide-y divide-slate-800 text-sm">
          {shown.map(a => (
            <li key={a.date} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="text-white">{longDay(a.date)}</span>
                {a.calledIn && <span className="text-xs text-slate-400"> · called in{a.callInReason ? ` (${a.callInReason})` : ''}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {a.excused && <Chip tone="slate">Excused</Chip>}
                {!a.excused && a.madeUp && <Chip tone="emerald">Made up</Chip>}
                {!a.excused && !a.madeUp && a.threshold && <Chip tone={a.failed ? 'rose' : 'amber'}>{a.failed ? 'Deadline passed' : `Make up by ${shortDay(a.deadline)}`}</Chip>}
                {!a.excused && !a.madeUp && !a.threshold && <Chip tone="blue">Open</Chip>}
                {canExcuse && !a.madeUp && (a.excused ? (
                  <button type="button" onClick={() => undo(a)} className="text-xs text-slate-400 hover:text-white underline">Undo excuse</button>
                ) : (
                  <button type="button" onClick={() => { setReason(''); setExcusing(a); }} className="text-xs text-blue-300 hover:text-blue-200 underline">Excuse</button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {status.absences.length > SHOWN && (
        <button type="button" onClick={() => setShowAll(s => !s)} className="text-xs text-blue-300 hover:text-blue-200">
          {showAll ? 'Show fewer' : `Show all ${status.absences.length}`}
        </button>
      )}
    </section>
  );
}

const shortDay = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Chip({ tone, children }: { tone: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue'; children: React.ReactNode }) {
  const style = {
    slate: 'bg-slate-800 border-slate-700 text-slate-300',
    emerald: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
    amber: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
    rose: 'bg-rose-500/15 border-rose-500/40 text-rose-200',
    blue: 'bg-blue-500/15 border-blue-500/40 text-blue-200',
  }[tone];
  return <span className={`text-[11px] px-2 py-0.5 rounded border ${style}`}>{children}</span>;
}
