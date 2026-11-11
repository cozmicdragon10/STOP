import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Settings, X } from 'lucide-react';
import { getFederalUnitCodes, updateClient } from '../../api';
import type { ClientNote, FederalUnitCode, SupervisingAgent } from '../../api';
import BusPassDialog from './BusPassDialog';
import AgentPicker from '../agents/AgentPicker';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import {
  BUS_PASS_MAX, CHAPERON_PHASES, CLIENT_FIELD_OPTIONS, EDITABLE_PROGRAM_STATUSES, FEDERAL_PROGRAM_TYPES, GROUP_TYPES_BY_PROGRAM, POLY_PROGRAM_TYPES, PRETRIAL_PROGRAM_TYPES, SO_ATTENDANCE_LIMIT_MONTHS, SO_PROGRAM_TYPES,
  STATE_FEE_PROGRAM_TYPES, formatPhase, isAttendanceOverdue, isIndividualGroup, isWholeNumber,
} from '../../utils/clients';
import { SO_PHASES, SO_TREATMENT_FEES, bipTreatmentFee } from '../../utils/soPhases';
import { formatBalance, toDisplayBalance } from '../../utils/balance';
import { ageFromBirthDate, toLocalDay } from '../../utils/dates';
import { polyVoucherMax, takesPolygraphs } from '../../utils/polygraph';

/* eslint-disable @typescript-eslint/no-explicit-any -- client and group rows are untyped throughout App */
interface Props {
  client: any;
  // A discharged client's program status is locked; only the Activate button changes it
  discharged: boolean;
  groups: any[];
  directoryAgents: SupervisingAgent[];
  // Active counselors' display names, for the Assessor choice
  counselors: string[];
  // The poly fee total belongs to an active poly fee override and is changed there
  polyOverrideActive: boolean;
  userEmail: string;
  // An error from loading the account (shown with this form's own errors)
  loadError: string;
  onDismissLoadError: () => void;
  // Where the Edit Info, Cancel, and Save Changes buttons go: the account header, with Make Payment and Discharge
  actionsSlot: HTMLElement | null;
  // Tells App whether there are unsaved changes, so it can ask before leaving the form
  onDirtyChange: (dirty: boolean) => void;
  // App wants to leave; shows the save or discard prompt. onLeaveResolved(true) goes ahead, false stays here.
  leaveRequested: boolean;
  onLeaveResolved: (leave: boolean) => void;
  // Saved; previousProgramType lets App ask about a BIP intake when the client was just moved to BIP
  onSaved: (saved: any, previousProgramType: string | null) => void;
  // A bus pass was granted: the client's new count and the Bus Pass note it added
  onBusPassGranted: (busPasses: number, note: ClientNote) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const PERSONAL_FIELDS = [
  { label: 'First Name', field: 'firstname' },
  { label: 'Last Name', field: 'lastname' },
  { label: 'Middle Name', field: 'middlename' },
  { label: 'DOC #', field: 'docnumber' },
  { label: 'Date of Birth', field: 'dateofbirth' },
  { label: 'Sex', field: 'sex' },
  { label: 'Race', field: 'race' },
  { label: 'Supervising Agent', field: 'supervisingagent' },
  { label: 'Program Status', field: 'programstatus' },
  { label: 'Program Start Date', field: 'programstartdate' },
  { label: 'Last Date Attended', field: 'lastdateattended' },
];
const CONTACT_FIELDS = [
  { label: 'Address', field: 'address' },
  { label: 'City', field: 'city' },
  { label: 'County', field: 'county' },
  { label: 'State', field: 'state' },
  { label: 'Zip', field: 'zip' },
  { label: 'Main Phone', field: 'mainphone' },
  { label: 'Alt Phone', field: 'altphone' },
  { label: 'Emergency Contact', field: 'emergencycontact' },
  { label: 'Emergency Contact Phone', field: 'emergencycontactphone' },
];
const ACCOUNT_FIELDS: { label: string; field: string; prefix: string; step?: string; min?: number; max?: number }[] = [
  { label: 'Treatment Fee', field: 'treatmentfee', prefix: '$' },
  { label: 'Account Balance', field: 'accountbalance', prefix: '$' },
  { label: 'Vouchers', field: 'vouchers', prefix: '' },
  // max is the client's full set for their phase (polyVoucherMax), filled in where the field is shown
  { label: 'Poly Fee Voucher', field: 'polyfeevoucher', prefix: '', step: '1', min: 0 },
];
const isDateField = (field: string) => field.includes('date') || field.includes('Date');
// Compares a field the way it's shown: dates without their time, money and counts as numbers (150 and 150.00 match)
// Federal units ({ code: units }) with blanks dropped and numbers compared as numbers, so 4 and "4.00" match
const normalizedUnits = (units: unknown) => JSON.stringify(Object.entries((units ?? {}) as Record<string, unknown>)
  .filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, Number(v)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
const sameValue = (field: string, a: unknown, b: unknown) => {
  if (field === 'federalunits') return normalizedUnits(a) === normalizedUnits(b);
  const [x, y] = [String(a ?? ''), String(b ?? '')];
  if (isDateField(field)) return x.split('T')[0] === y.split('T')[0];
  if (ACCOUNT_FIELDS.some(f => f.field === field) && x !== '' && y !== '') return Number(x) === Number(y);
  return x === y;
};
const inputClass = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm';

// The Information tab's details: Personal, Contact, and Program & Account sections, shown read-only until Edit Info.
// While editing, only the changed fields are kept, laid over the current client, so a status change made meanwhile
// (Discharge / Activate) still shows and is saved.
export default function ClientInfoForm({ client, discharged, groups, directoryAgents, counselors, polyOverrideActive, userEmail, loadError, onDismissLoadError, actionsSlot, onDirtyChange, leaveRequested, onLeaveResolved, onSaved, onBusPassGranted }: Props) {
  const [busPassOpen, setBusPassOpen] = useState(false);
  // Federal billing codes (Admin > Billing Federal Units); each client program shows the codes it tracks
  const [unitCodes, setUnitCodes] = useState<FederalUnitCode[]>([]);
  useEffect(() => {
    getFederalUnitCodes().then(setUnitCodes).catch(() => setUnitCodes([]));
  }, []);
  // null while not editing; otherwise the fields changed so far
  const [edits, setEdits] = useState<Record<string, any> | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const editing = edits !== null;
  const form = { ...client, ...(edits ?? {}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update = (changes: (f: any) => Record<string, any>) => setEdits(prev => ({ ...(prev ?? {}), ...changes({ ...client, ...(prev ?? {}) }) }));
  const setField = (field: string, value: unknown) => update(() => ({ [field]: value }));

  // A field typed back to what it was doesn't count as a change
  const dirty = Object.entries(edits ?? {}).some(([field, value]) => !sameValue(field, value, client[field]));
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  // The prompt is waiting and the changes are gone, either saved or discarded: carry on leaving
  useEffect(() => {
    if (leaveRequested && !dirty) onLeaveResolved(true);
  }, [leaveRequested, dirty, onLeaveResolved]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await updateClient(client.clientid, { ...form, updatedBy: userEmail });
      // Prefer the row the server returned (includes joined group name); fall back to the form values
      onSaved({ ...form, ...(res.client ?? {}) }, client.programtype ?? null);
      setEdits(null);
    } catch (err) {
      // Stay in edit mode so nothing typed is lost
      setError(err instanceof Error ? err.message : 'Failed to save client information.');
    } finally {
      setSaving(false);
    }
  };

  const shownError = error || loadError;
  const programType = form.programtype;
  const programUnitCodes = unitCodes.filter(c => c.programs.includes(programType || ''));
  const unitsOf = (source: { federalunits?: Record<string, unknown> | null }, code: string) => {
    const v = source.federalunits?.[code];
    return v === null || v === undefined || v === '' ? '' : String(Number(v));
  };
  const setUnits = (code: string, value: string) => setField('federalunits', { ...(form.federalunits ?? {}), [code]: value });

  return (
    <>
      {busPassOpen && (
        <BusPassDialog
          clientId={client.clientid}
          clientName={`${client.lastname}, ${client.firstname}`}
          busPasses={Number(client.buspasses ?? 0)}
          userEmail={userEmail}
          onGranted={(busPasses, note) => { setBusPassOpen(false); onBusPassGranted(busPasses, note); }}
          onClose={() => setBusPassOpen(false)}
        />
      )}
      {shownError && (
        <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg text-sm flex justify-between items-center gap-3">
          <span>{shownError}</span>
          <button onClick={() => { setError(''); onDismissLoadError(); }} className="text-red-400 hover:text-red-200"><X size={14} /></button>
        </div>
      )}

      {leaveRequested && (
        // mb-0! because the parent's space-y spacing would otherwise stop the backdrop short of the bottom of the screen
        <div className="fixed inset-0 mb-0! bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="unsaved-changes-title">
          <div className="bg-slate-900 border border-amber-500/40 rounded-xl p-6 w-full max-w-md max-h-full overflow-y-auto space-y-4 text-sm">
            <div>
              <h3 id="unsaved-changes-title" className="font-semibold text-white">Save your changes?</h3>
              <p className="text-xs text-slate-400 mt-1">You changed {client.firstname} {client.lastname}'s information and haven't saved it.</p>
            </div>
            {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => { setError(''); onLeaveResolved(false); }} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Keep Editing</button>
              <button type="button" disabled={saving} onClick={() => { setEdits(null); setError(''); }} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Discard Changes</button>
              <button type="button" disabled={saving} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">
                <CheckCircle2 size={14} /> {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Save toolbar */}
      {actionsSlot && createPortal(!editing ? (
        <button
          onClick={() => setEdits({})}
          className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
        >
          <Settings size={14} /> Edit Info
        </button>
      ) : (
        <>
          <button
            onClick={() => { setEdits(null); setError(''); }}
            className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
          >Cancel</button>
          <button
            disabled={saving}
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
          >
            <CheckCircle2 size={14} /> Save Changes
          </button>
        </>
      ), actionsSlot)}

      {/* Section 1 – Personal Info */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
        <h3 className="text-xs font-bold uppercase text-blue-400 mb-4 tracking-wider">Personal Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {PERSONAL_FIELDS.map(({ label, field }) => (
            <div key={field}>
              <p className="text-xs text-slate-500 mb-0.5">{label}</p>
              {editing && field === 'programstatus' && discharged ? (
                // Locked while discharged; the Activate button is the only way out
                <div>
                  <p className="w-full bg-slate-900/50 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-400 text-sm cursor-not-allowed">{client.programstatus}</p>
                  <p className="text-xs text-slate-500 mt-1">Locked while discharged. Use Activate to change it.</p>
                </div>
              ) : editing && field === 'programstatus' ? (
                <select value={form.programstatus || ''} onChange={e => setField('programstatus', e.target.value)} className={inputClass}>
                  <option value="">-- Select status --</option>
                  {EDITABLE_PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : editing && CLIENT_FIELD_OPTIONS[field] ? (
                <select value={form[field] || ''} onChange={e => setField(field, e.target.value)} className={inputClass}>
                  <option value="">-- Select {label.toLowerCase()} --</option>
                  {CLIENT_FIELD_OPTIONS[field].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : editing && field === 'supervisingagent' ? (
                <AgentPicker value={form.supervisingagent || ''} onChange={v => setField('supervisingagent', v)} agents={directoryAgents} className={inputClass} />
              ) : editing ? (
                <div className="flex items-center gap-3">
                  <input
                    type={isDateField(field) ? 'date' : 'text'}
                    value={form[field] ? (isDateField(field) ? String(form[field]).split('T')[0] : form[field]) : ''}
                    max={field === 'dateofbirth' ? todayLocal() : undefined}
                    onChange={e => setField(field, e.target.value)}
                    className={inputClass}
                  />
                  {field === 'dateofbirth' && ageFromBirthDate(form.dateofbirth) !== null && (
                    <span className="text-xs text-slate-400 whitespace-nowrap">Age {ageFromBirthDate(form.dateofbirth)}</span>
                  )}
                </div>
              ) : (
                <p
                  className={field === 'lastdateattended' && isAttendanceOverdue(client) ? 'text-red-400 font-semibold' : 'text-white font-medium'}
                  title={field === 'lastdateattended' && isAttendanceOverdue(client)
                    ? `Overdue: more than ${SO_ATTENDANCE_LIMIT_MONTHS[client.phase]} month${SO_ATTENDANCE_LIMIT_MONTHS[client.phase] === 1 ? '' : 's'} since last attended for ${client.phase}`
                    : undefined}
                >
                  {field === 'dateofbirth'
                    ? (client.dateofbirth
                        ? <>{toLocalDay(client.dateofbirth).toLocaleDateString()} <span className="text-slate-400 font-normal">(Age {ageFromBirthDate(client.dateofbirth)})</span></>
                        : '—')
                    : isDateField(field)
                    ? (client[field] ? new Date(client[field]).toLocaleDateString() : '—')
                    : (client[field] || '—')}
                </p>
              )}
            </div>
          ))}
          {/* Derived from polygraph results, so shown read-only and only for the SO and Poly Only programs */}
          {POLY_PROGRAM_TYPES.includes(programType || '') && (
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Last Polygraph</p>
              <p className="text-white font-medium">{client.lastpoly ? new Date(client.lastpoly).toLocaleDateString() : '—'}</p>
            </div>
          )}
          <div className="sm:col-span-2">
            <p className="text-xs text-slate-500 mb-0.5">Comments</p>
            {editing ? (
              <textarea rows={3} value={form.comments || ''} onChange={e => setField('comments', e.target.value)} className={inputClass} />
            ) : (
              <p className="text-white font-medium">{client.comments || '—'}</p>
            )}
          </div>
        </div>
      </div>

      {/* Section 2 – Contact Info */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
        <h3 className="text-xs font-bold uppercase text-blue-400 mb-4 tracking-wider">Contact Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {CONTACT_FIELDS.map(({ label, field }) => (
            <div key={field}>
              <p className="text-xs text-slate-500 mb-0.5">{label}</p>
              {editing ? (
                <input type="text" value={form[field] || ''} onChange={e => setField(field, e.target.value)} className={inputClass} />
              ) : (
                <p className="text-white font-medium">{client[field] || '—'}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Section 3 – Program & Account Info */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
        <h3 className="text-xs font-bold uppercase text-blue-400 mb-4 tracking-wider">Program &amp; Account Info</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Program Type</p>
            {editing ? (
              <select
                value={form.programtype || ''}
                onChange={e => {
                  const newType = e.target.value;
                  update(f => {
                    // Switching programs resets the phase/week to one that fits the new program
                    const phase = SO_PROGRAM_TYPES.includes(newType) && !SO_PHASES.includes(f.phase) ? 'Phase 1 - Weekly'
                      : newType === 'BIP' && !isWholeNumber(f.phase) ? '0'
                      : newType === 'Chaperon' && !CHAPERON_PHASES.includes(f.phase) ? 'Chaperon'
                      : f.phase;
                    // BIP takes the Admin BIP price; Federal SO has no treatment fee; State and Voluntary SO take the Admin price for the phase
                    const treatmentfee = newType === 'BIP' ? bipTreatmentFee()
                      : newType === 'Federal SO' ? 0
                      : STATE_FEE_PROGRAM_TYPES.includes(newType) && SO_TREATMENT_FEES[phase] !== undefined ? SO_TREATMENT_FEES[phase]
                      : f.treatmentfee;
                    return { programtype: newType, phase, treatmentfee };
                  });
                }}
                className={inputClass}
              >
                <option value="">-- Select --</option>
                <option value="State SO">State SO</option>
                <option value="Federal SO">Federal SO</option>
                <option value="BIP">BIP</option>
                <option value="Voluntary SO">Voluntary SO</option>
                <option value="Poly Only">Poly Only</option>
                <option value="Fed Drug Test">Fed Drug Test</option>
                <option value="Chaperon">Chaperon</option>
              </select>
            ) : (
              <p className="text-white font-medium">{client.programtype || '—'}</p>
            )}
            {/* Federal SO and Fed Drug Test clients can be pretrial; changed with Edit Info */}
            {PRETRIAL_PROGRAM_TYPES.includes(programType || '') && (
              <label className={`mt-2 flex items-center gap-1.5 text-slate-200 text-sm whitespace-nowrap ${editing ? 'cursor-pointer' : 'cursor-default'}`}>
                <input
                  type="checkbox"
                  checked={!!form.pretrial}
                  disabled={!editing}
                  onChange={e => setField('pretrial', e.target.checked)}
                  className="accent-blue-500 disabled:opacity-60"
                />
                Pretrial
              </label>
            )}
          </div>
          {/* SO programs pick a phase (which sets the treatment fee); BIP clients store a whole-number week */}
          <div>
            <p className="text-xs text-slate-500 mb-0.5">{programType === 'BIP' ? 'Week' : 'Phase'}</p>
            {editing && SO_PROGRAM_TYPES.includes(form.programtype || '') ? (
              <select
                value={form.phase || ''}
                onChange={e => {
                  const phase = e.target.value;
                  update(f => ({
                    phase,
                    // Federal SO has no treatment fee, so its phase doesn't set one
                    ...(STATE_FEE_PROGRAM_TYPES.includes(f.programtype) && SO_TREATMENT_FEES[phase] !== undefined ? { treatmentfee: SO_TREATMENT_FEES[phase] } : {}),
                    // The server trims vouchers over the new phase's full set; show that here too
                    ...(Number(f.polyfeevoucher ?? 0) > polyVoucherMax(phase) ? { polyfeevoucher: polyVoucherMax(phase) } : {}),
                  }));
                }}
                className={inputClass}
              >
                <option value="">-- Select phase --</option>
                {SO_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                {form.phase && !SO_PHASES.includes(form.phase) && (
                  <option value={form.phase}>{form.phase} (current)</option>
                )}
              </select>
            ) : editing && form.programtype === 'BIP' ? (
              <input type="number" min={0} step={1} value={form.phase ?? ''} onChange={e => setField('phase', e.target.value)} className={inputClass} />
            ) : editing ? (
              <input type="text" value={form.phase || ''} onChange={e => setField('phase', e.target.value)} className={inputClass} />
            ) : (
              <p className="text-white font-medium">{formatPhase(client.programtype, client.phase) || '—'}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Group</p>
            {editing ? (
              <select value={form.groupid || ''} onChange={e => setField('groupid', e.target.value)} className={inputClass}>
                <option value="">-- None --</option>
                {groups.filter(g => (g.active !== false || g.groupid === form.groupid)
                  && (!GROUP_TYPES_BY_PROGRAM[form.programtype || '']
                    || GROUP_TYPES_BY_PROGRAM[form.programtype || ''].includes((g.programtype || '').trim().toUpperCase())
                    || g.groupid === form.groupid)
                ).map(g => <option key={g.groupid} value={g.groupid}>{g.groupname}{g.active === false ? ' (inactive)' : ''}</option>)}
              </select>
            ) : (
              <p className="text-white font-medium">{groups.find(g => g.groupid === client.groupid)?.groupname || client.groupid || '—'}</p>
            )}
          </div>
          {/* SO clients can also be in a counselor's individual group, alongside (or instead of) their regular group */}
          {SO_PROGRAM_TYPES.includes((editing ? form.programtype : client.programtype) || '') && (
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Individual Group</p>
              {editing ? (
                <select value={form.individualgroupid || ''} onChange={e => setField('individualgroupid', e.target.value ? Number(e.target.value) : null)} className={inputClass}>
                  <option value="">-- None --</option>
                  {groups.filter(g => isIndividualGroup(g.programtype) && (g.active !== false || g.groupid === form.individualgroupid))
                    .map(g => <option key={g.groupid} value={g.groupid}>{g.groupname}{g.active === false ? ' (inactive)' : ''}</option>)}
                </select>
              ) : (
                <p className="text-white font-medium">{groups.find(g => g.groupid === client.individualgroupid)?.groupname || '—'}</p>
              )}
            </div>
          )}
          {/* The counselor the client is waiting to be assessed by; closing an assessment clears it */}
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Waiting for Assessment With</p>
            {editing ? (
              <select value={form.assessor || ''} onChange={e => setField('assessor', e.target.value)} className={inputClass}>
                <option value="">-- Not waiting --</option>
                {[...new Set([...(form.assessor ? [form.assessor] : []), ...counselors])].map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <p className="text-white font-medium">{client.assessor || '—'}</p>
            )}
          </div>
          {/* Federal clients only: how many bus passes they can still be granted (0 to 2); granting one adds a Bus Pass note */}
          {FEDERAL_PROGRAM_TYPES.includes(programType || '') && (
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Bus Passes</p>
              {editing ? (
                <div className="space-y-2">
                  <input type="number" min={0} max={BUS_PASS_MAX} step={1} value={form.buspasses ?? 0} onChange={e => setField('buspasses', e.target.value)} className={inputClass} aria-label="Bus passes" />
                  {/* At the start of each calendar month the count is set to this, replacing what's left */}
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    Monthly refill
                    <select value={String(form.buspassrefill ?? 0)} onChange={e => setField('buspassrefill', e.target.value)} className={`${inputClass} w-auto`}>
                      <option value="0">None</option>
                      {Array.from({ length: BUS_PASS_MAX }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} on the 1st of each month</option>)}
                    </select>
                  </label>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <p className="text-white font-medium">{Number(client.buspasses ?? 0)}</p>
                    {Number(client.buspasses ?? 0) > 0 && (
                      <button type="button" onClick={() => setBusPassOpen(true)} className="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded-lg text-xs font-semibold">Grant Bus Pass</button>
                    )}
                  </div>
                  {Number(client.buspassrefill ?? 0) > 0 && (
                    <p className="text-xs text-slate-500 mt-0.5">Refills to {Number(client.buspassrefill)} on the 1st of each month</p>
                  )}
                </>
              )}
            </div>
          )}
          {/* Federal billing units for the codes this client's program tracks (Federal SO, Fed Drug Test); blank until entered */}
          {programUnitCodes.length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-xs text-slate-500 mb-1">Federal Units</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {programUnitCodes.map(c => (
                  <div key={c.code} className="bg-slate-950/50 border border-slate-800 rounded-lg px-2.5 py-1.5">
                    <p className="text-[0.6875rem] text-slate-400 truncate" title={`${c.code} ${c.label}`}><span className="text-blue-400 font-semibold">{c.code}</span> {c.label}</p>
                    {editing ? (
                      <input type="number" min={0} step="any" value={unitsOf(form, c.code)} onChange={e => setUnits(c.code, e.target.value)} className={`${inputClass} mt-1`} aria-label={`${c.code} ${c.label}`} />
                    ) : (
                      <p className="text-white font-medium">{unitsOf(client, c.code) || '—'}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* BIP, Fed Drug Test and Chaperon clients don't take polygraphs, so their poly fee and vouchers aren't shown */}
          {ACCOUNT_FIELDS.filter(({ field }) => !(!takesPolygraphs(programType) && field === 'polyfeevoucher')).map(({ label, field, prefix, step = '0.01', min, max }) => (
            <div key={field}>
              <p className="text-xs text-slate-500 mb-0.5">{label}</p>
              {editing ? (
                <input
                  type="number"
                  step={step}
                  min={min}
                  max={field === 'polyfeevoucher' ? polyVoucherMax(form.phase) : max}
                  value={field === 'accountbalance' && form[field] !== '' && form[field] != null ? toDisplayBalance(form[field]) : (form[field] ?? '')}
                  onChange={e => setField(field, field === 'accountbalance' && e.target.value !== '' ? toDisplayBalance(e.target.value) : e.target.value)}
                  className={inputClass}
                />
              ) : field === 'accountbalance' ? (
                <p className={`font-medium ${toDisplayBalance(client[field]) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(client[field])}</p>
              ) : field === 'polyfeevoucher' ? (
                <p className="font-medium text-white">{Number(client[field] ?? 0)}/{polyVoucherMax(client.phase)}</p>
              ) : (
                <p className="font-medium text-white">
                  {prefix}{client[field] != null ? Number(client[field]).toFixed(2) : '—'}
                </p>
              )}
            </div>
          ))}
          {/* Poly fee progress: amount paid so far out of the total poly fee */}
          {takesPolygraphs(programType) && <div>
            <p className="text-xs text-slate-500 mb-0.5">Poly Fee (Paid / Total)</p>
            {editing ? (
              <div className="flex items-center gap-2">
                {(['polyfeepaid', 'polyfee'] as const).map((field, i) => (
                  <Fragment key={field}>
                    {i === 1 && <span className="text-slate-500">/</span>}
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      aria-label={field === 'polyfeepaid' ? 'Poly fee paid' : 'Poly fee total'}
                      value={form[field] ?? ''}
                      onChange={e => setField(field, e.target.value)}
                      // The total belongs to an active poly fee override; change it there
                      disabled={field === 'polyfee' && polyOverrideActive}
                      title={field === 'polyfee' && polyOverrideActive ? 'Set by the Temporary Poly Fee Override' : undefined}
                      className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm disabled:opacity-50"
                    />
                  </Fragment>
                ))}
              </div>
            ) : (() => {
              const paid = Number(client.polyfeepaid ?? 0);
              const total = Number(client.polyfee ?? 250);
              const status = paid >= total ? { text: 'Paid in full', color: 'text-emerald-400' }
                : paid > 0 ? { text: `$${(total - paid).toFixed(2)} remaining`, color: 'text-amber-400' }
                : { text: 'Not paid', color: 'text-slate-500' };
              return (
                <p className="font-medium text-white">
                  ${paid.toFixed(2)} / ${total.toFixed(2)}
                  <span className={`ml-2 text-xs font-normal ${status.color}`}>{status.text}</span>
                </p>
              );
            })()}
          </div>}
        </div>
      </div>
    </>
  );
}
