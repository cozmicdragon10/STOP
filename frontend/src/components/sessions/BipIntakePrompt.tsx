import { useState } from 'react';
import BipAssessmentPicker, { bipChoiceProblem, counselorChoices, openBipAssessment } from './BipAssessmentPicker';
import type { BipAssessmentChoice } from './BipAssessmentPicker';

interface Employee {
  displayname: string;
  role: string;
  active?: boolean;
}

interface Props {
  // groupCounselor: the counselor (display name) of the client's group, picked by default when it is an active Counselor
  client: { clientid: number; name: string; groupCounselor?: string | null };
  employees: Employee[];
  user: { employeeemail: string };
  onDone: (message: string | null) => void;
}

// Asked when a client is created as BIP or switched to BIP: open a BIP intake assessment (BIP Intake, DV Assessment,
// or any other price list entry of kind BIP intake) on the Assessments & Individuals tab, or None. Nothing is charged
// until the assessment is completed there.
export default function BipIntakePrompt({ client, employees, user, onDone }: Props) {
  const [value, setValue] = useState<BipAssessmentChoice>(() => ({ choice: '', provider: counselorChoices(employees, client.groupCounselor).defaultCounselor }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    const problem = bipChoiceProblem(value);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const name = await openBipAssessment(client.clientid, value, user.employeeemail);
      onDone(name ? `${name} for ${client.name} opened. Complete it on the Assessments & Individuals tab.` : null);
    } catch (err: any) {
      setError(err.message || 'Failed to open the assessment.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="bip-intake-title">
      <div className="bg-slate-900 border border-blue-500/40 rounded-xl p-6 w-full max-w-md space-y-4 text-sm">
        <div>
          <h3 id="bip-intake-title" className="font-semibold text-white">Open a BIP Assessment?</h3>
          <p className="text-xs text-slate-400 mt-1">
            <span className="text-emerald-400 font-semibold">{client.name}</span> is now a BIP client. Choose the intake assessment to open. It is completed on the Assessments & Individuals tab once it is paid and the intake paperwork is done.
          </p>
        </div>

        <BipAssessmentPicker mode="intake" clientId={client.clientid} employees={employees} groupCounselor={client.groupCounselor} value={value} onChange={v => { setValue(v); setError(''); }} />

        {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving || !value.choice} onClick={create} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold">
            {saving ? 'Opening...' : value.choice === 'none' ? 'Continue Without Assessment' : 'Open Assessment'}
          </button>
        </div>
      </div>
    </div>
  );
}
