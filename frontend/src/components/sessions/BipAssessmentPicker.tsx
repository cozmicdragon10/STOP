import { useEffect, useState } from 'react';
import { getBipIntake, getSessionTypes, saveOpenIndividualSession } from '../../api';
import type { BipIntake, SessionType } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';

interface Employee {
  displayname: string;
  role: string;
  active?: boolean;
}

// What was picked: choice is a price list entry id, 'none', or '' (nothing yet). fee and name come with an entry.
export interface BipAssessmentChoice {
  choice: string;
  provider: string;
  fee?: number;
  name?: string;
}

// Only active Counselor accounts can be picked; the counselor of the client's group is the default when it is one
export const counselorChoices = (employees: Employee[], groupCounselor?: string | null) => {
  const counselors = Array.from(new Set(employees.filter(e => e.active !== false && e.role === 'Counselor').map(e => e.displayname)))
    .sort((a, b) => a.localeCompare(b));
  const defaultCounselor = counselors.find(c => c.trim().toLowerCase() === String(groupCounselor || '').trim().toLowerCase()) ?? '';
  return { counselors, defaultCounselor };
};

// The first problem with the choice, or null when it can be used
export const bipChoiceProblem = (value: BipAssessmentChoice): string | null => {
  if (!value.choice) return 'Choose an assessment, or None.';
  if (value.choice !== 'none' && !value.provider) return 'Choose the counselor.';
  return null;
};

// Opens the picked assessment on the Assessments & Individuals tab (nothing is charged until it is completed there).
// Returns the assessment's name, or null for None.
export const openBipAssessment = async (clientId: number, value: BipAssessmentChoice, userEmail: string): Promise<string | null> => {
  if (value.choice === 'none') return null;
  await saveOpenIndividualSession({
    client: clientId, category: 'Assessment', sessionTypeId: Number(value.choice), date: todayLocal(), fee: value.fee ?? 0,
    payment: 0, paymentMethod: 'Cash', provider: value.provider, comments: '', paymentComments: '', user: userEmail,
  });
  return value.name ?? 'Assessment';
};

interface Props {
  // 'intake': BIP Intake / DV Assessment (a new BIP client). 'reinstate': BIP Reinstate when the client's last intake allows
  // it (under a year), otherwise a new BIP Intake / DV Assessment.
  mode: 'intake' | 'reinstate';
  clientId: number;
  employees: Employee[];
  groupCounselor?: string | null;
  value: BipAssessmentChoice;
  onChange: (value: BipAssessmentChoice) => void;
}

const formatDay = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString();

export default function BipAssessmentPicker({ mode, clientId, employees, groupCounselor, value, onChange }: Props) {
  const [types, setTypes] = useState<SessionType[] | null>(null);
  // undefined while loading (reinstate mode only)
  const [intake, setIntake] = useState<BipIntake | null | undefined>(undefined);
  const [error, setError] = useState('');
  const { counselors, defaultCounselor } = counselorChoices(employees, groupCounselor);

  useEffect(() => {
    let cancelled = false;
    getSessionTypes()
      .then(all => { if (!cancelled) setTypes(all.filter(t => t.active).sort((a, b) => a.name.localeCompare(b.name))); })
      .catch(err => { if (!cancelled) { setTypes([]); setError(err.message || 'Failed to load the price list.'); } });
    if (mode === 'reinstate') {
      getBipIntake(clientId, todayLocal())
        .then(data => { if (!cancelled) setIntake(data); })
        .catch(err => { if (!cancelled) { setIntake(null); setError(err.message || 'Failed to look up the last BIP intake.'); } });
    }
    return () => { cancelled = true; };
  }, [mode, clientId]);

  const loading = types === null || (mode === 'reinstate' && intake === undefined);
  // A reinstate is allowed under a year after the last intake (it costs the late fee from 6 months on), except when the
  // intake before the discharge was done at another provider, which needs our own intake instead
  const canReinstate = mode === 'reinstate' && !!intake && intake.window !== 'expired' && !intake.needsOurIntake;
  const options = (types ?? [])
    .filter(t => (canReinstate ? t.kind === 'BIP Reinstate' : t.kind === 'BIP Intake'))
    .map(t => ({ id: String(t.sessiontypeid), name: t.name, fee: Number(canReinstate && intake!.window === 'late' ? t.latefee ?? t.fee : t.fee) }));

  const pick = (id: string) => {
    const o = options.find(x => x.id === id);
    onChange({ choice: id, provider: value.provider || defaultCounselor, fee: o?.fee, name: o?.name });
  };

  if (loading) return <p className="text-xs text-slate-500">Loading…</p>;

  return (
    <div className="space-y-3">
      {mode === 'reinstate' && (
        intake && canReinstate ? (
          <p className="text-xs text-slate-400">Last {intake.intakename}: {formatDay(intake.intakedate)} ({intake.window === 'early' ? 'under 6 months ago' : '6 months to a year ago'}).</p>
        ) : (
          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
            {intake?.needsOurIntake
              ? `The client's intake before their discharge was done at another provider (${intake.intakename}), so a BIP Reinstate can't be done. Open our BIP Intake or DV Assessment instead.`
              : `${intake ? `Last ${intake.intakename} was ${formatDay(intake.intakedate)}, a year or more ago,` : 'No BIP Intake or DV Assessment is on record,'} so a BIP Reinstate can't be done. Open a new BIP Intake or DV Assessment instead.`}
          </p>
        )
      )}
      <div className="space-y-2">
        {[...options.map(o => ({ id: o.id, label: o.name, detail: `$${o.fee.toFixed(2)}` })), { id: 'none', label: 'None', detail: 'No assessment now' }].map(o => (
          <label key={o.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs ${value.choice === o.id ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
            <span className="flex items-center gap-2">
              <input type="radio" name={`bip-assessment-${mode}`} value={o.id} checked={value.choice === o.id} onChange={() => pick(o.id)} className="accent-blue-500" />
              {o.label}
            </span>
            <span className="text-slate-400">{o.detail}</span>
          </label>
        ))}
        {options.length === 0 && !error && (
          <p className="text-xs text-slate-500">No {canReinstate ? 'BIP reinstate' : 'BIP intake'} assessments are on the price list. A Business Administrator can add them in Admin.</p>
        )}
      </div>

      {value.choice && value.choice !== 'none' && (
        <div>
          <label htmlFor={`bip-assessment-provider-${mode}`} className="block text-xs text-slate-400 uppercase mb-1">Counselor</label>
          <select id={`bip-assessment-provider-${mode}`} value={value.provider} onChange={e => onChange({ ...value, provider: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm">
            <option value="">Select…</option>
            {counselors.map(p => <option key={p} value={p}>{p}{p === defaultCounselor ? ' (group counselor)' : ''}</option>)}
          </select>
          {counselors.length === 0 && <p className="text-xs text-amber-400 mt-1">No active Counselor accounts. Add one in Admin.</p>}
          {!defaultCounselor && counselors.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">{groupCounselor ? `The group's counselor (${groupCounselor}) is not an active Counselor account.` : 'The client has no group, so pick the counselor.'}</p>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}
    </div>
  );
}
