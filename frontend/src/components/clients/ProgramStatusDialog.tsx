import { useState } from 'react';
import { changeClientProgramStatus } from '../../api';
import BipAssessmentPicker from '../sessions/BipAssessmentPicker';
import { bipChoiceProblem, counselorChoices, openBipAssessment } from '../sessions/bipAssessment';
import type { BipAssessmentChoice } from '../sessions/bipAssessment';
import { DISCHARGE_STATUSES, DISCHARGE_SUBCATEGORIES, EDITABLE_PROGRAM_STATUSES } from '../../utils/clients';

/* eslint-disable @typescript-eslint/no-explicit-any -- client and employee rows are untyped throughout App */
interface Props {
  // Discharge (Business Administrators only) or Activate (any account type, discharged clients only)
  action: 'discharge' | 'activate';
  client: any;
  employees: any[];
  // The client's group counselor (display name), suggested for a BIP reinstate
  groupCounselor: string | null;
  userEmail: string;
  onClose: () => void;
  // The new program status was saved; App updates the client and reloads the case notes
  onStatusChanged: (programstatus: string) => Promise<void>;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Pick a status and write a note, Proceed, then confirm. Activating a BIP client also offers to open a BIP Reinstate
// (or a new intake when a reinstate isn't allowed).
export default function ProgramStatusDialog({ action, client, employees, groupCounselor, userEmail, onClose, onStatusChanged, onSuccess, onError }: Props) {
  const activating = action === 'activate';
  const [choice, setChoice] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reinstateChoice, setReinstateChoice] = useState<BipAssessmentChoice>(() => ({
    choice: '', provider: counselorChoices(employees, groupCounselor).defaultCounselor,
  }));
  const offerReinstate = activating && client.programtype === 'BIP';

  const label = activating ? 'Activation' : 'Discharge';
  const choices = activating ? EDITABLE_PROGRAM_STATUSES : DISCHARGE_STATUSES;
  const actionButton = activating ? 'bg-blue-600 hover:bg-blue-500' : 'bg-amber-600 hover:bg-amber-500';
  const subcategories = activating ? undefined : DISCHARGE_SUBCATEGORIES[choice];
  const choiceLabel = subcategory ? `${choice} (${subcategory})` : choice;
  const name = `${client.firstname} ${client.lastname}`;

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      const programstatus = await changeClientProgramStatus(action, client.clientid, choice, subcategory || null, note.trim(), userEmail);
      await onStatusChanged(programstatus);
      onSuccess(activating
        ? `${name} set to ${programstatus}.`
        : `${name} discharged as ${programstatus}. Discharge summary saved to Attachments.`);
      if (offerReinstate && reinstateChoice.choice !== 'none') {
        // The client is already activated; a failure here only means the assessment wasn't opened
        try {
          const assessment = await openBipAssessment(client.clientid, reinstateChoice, userEmail);
          onSuccess(`${name} set to ${programstatus}. ${assessment} opened on the Assessments & Individuals tab.`);
        } catch (err) {
          onError(`Client activated, but the assessment could not be opened: ${err instanceof Error && err.message ? err.message : 'unknown error'}. Open it on the Assessments & Individuals tab.`);
        }
      }
      onClose();
    } catch (err) {
      // Shown inside the dialog, which stays on the confirm step so it can be retried
      setError(err instanceof Error && err.message ? err.message : `Failed to ${action} client.`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="status-dialog-title">
      <div className={`bg-slate-900 border rounded-xl p-6 w-full max-w-md space-y-4 text-sm ${activating ? 'border-blue-500/40' : 'border-amber-500/40'}`}>
        <div>
          <h3 id="status-dialog-title" className="font-semibold text-white">{activating ? 'Activate Client' : 'Discharge Client'}</h3>
          <p className="text-xs text-slate-400 mt-1">
            <span className="text-emerald-400 font-semibold">{name}</span> · Current status: {client.programstatus || 'None'}
          </p>
        </div>
        {!confirming ? (
          <>
            <div>
              <p className="block text-xs text-slate-400 uppercase mb-2">{activating ? 'New Status' : 'Discharge Type'}</p>
              <div className="grid grid-cols-2 gap-2">
                {choices.map(s => (
                  <label key={s} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs ${choice === s ? (activating ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-amber-500 bg-amber-500/10 text-white') : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
                    <input type="radio" name="status-dialog-choice" value={s} checked={choice === s} onChange={() => { setChoice(s); setSubcategory(''); }} className={activating ? 'accent-blue-500' : 'accent-amber-500'} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            {subcategories && (
              <div>
                <p className="block text-xs text-slate-400 uppercase mb-2">{choice} Subcategory</p>
                <div className="grid grid-cols-2 gap-2">
                  {subcategories.map(s => (
                    <label key={s} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs ${subcategory === s ? 'border-amber-500 bg-amber-500/10 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
                      <input type="radio" name="status-dialog-subcategory" value={s} checked={subcategory === s} onChange={() => setSubcategory(s)} className="accent-amber-500" />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label htmlFor="status-dialog-note" className="block text-xs text-slate-400 uppercase mb-1">{label} Note</label>
              <textarea
                id="status-dialog-note"
                rows={4}
                value={note}
                onChange={e => setNote(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
              />
            </div>
            {offerReinstate && (
              <div className="border-t border-slate-800 pt-4">
                <p className="block text-xs text-slate-400 uppercase mb-2">BIP Reinstate Assessment</p>
                <BipAssessmentPicker
                  mode="reinstate"
                  clientId={client.clientid}
                  employees={employees}
                  groupCounselor={groupCounselor}
                  value={reinstateChoice}
                  onChange={setReinstateChoice}
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
              <button
                type="button"
                disabled={!choice || (!!subcategories && !subcategory) || !note.trim() || (offerReinstate && !!bipChoiceProblem(reinstateChoice))}
                onClick={() => setConfirming(true)}
                className={`${actionButton} disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold`}
              >
                Proceed
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={`text-xs rounded-lg p-3 border ${activating ? 'text-blue-300 bg-blue-500/10 border-blue-500/30' : 'text-amber-300 bg-amber-500/10 border-amber-500/30'}`}>
              The program status will change from <span className="font-semibold">{client.programstatus || 'None'}</span> to <span className="font-semibold">{choiceLabel}</span>, and this note will be added to the case notes.{!activating && ' A discharge summary PDF will be saved to the client\'s attachments.'}
              {offerReinstate && reinstateChoice.choice !== 'none' && <> A <span className="font-semibold">{reinstateChoice.name}</span> assessment will be opened with {reinstateChoice.provider}.</>}
            </p>
            <p className="text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-3 whitespace-pre-wrap">{label} - {choiceLabel}: {note.trim()}</p>
            {error && (
              <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => { setError(''); setConfirming(false); }} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Back</button>
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirm}
                className={`${actionButton} disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold`}
              >
                {saving ? 'Saving...' : activating ? 'Confirm Activation' : 'Confirm Discharge'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
