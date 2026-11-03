import { useEffect, useState } from 'react';
import { getEmployees } from '../../api';
import { OBSERVER_ROLES, isDrugTestGroup } from '../../utils/clients';

interface Employee {
  employeeemail: string;
  displayname: string | null;
  role: string;
  active: boolean;
}

interface Props {
  // The group's usual counselor (display name)
  usualCounselor: string | null | undefined;
  // The group's program type; drug-test groups have an observer (an Office Admin or Business Administrator) instead
  groupProgram?: string | null;
  value: string | null;
  onChange: (email: string | null) => void;
  disabled?: boolean;
}

const COUNSELOR_ROLES = ['Counselor', 'Therapist'];

// Office Admins and Business Administrators only. When the office checks a group in, the group's usual counselor (or
// observer) is responsible for its cash unless a covering one is picked here.
export default function CoveringCounselorPicker({ usualCounselor, groupProgram, value, onChange, disabled }: Props) {
  const [counselors, setCounselors] = useState<Employee[]>([]);
  const [loadError, setLoadError] = useState('');
  const observer = isDrugTestGroup(groupProgram);
  const lead = observer ? 'observer' : 'counselor';

  useEffect(() => {
    let cancelled = false;
    const roles = observer ? OBSERVER_ROLES : COUNSELOR_ROLES;
    getEmployees()
      .then((data: unknown) => {
        if (cancelled) return;
        if (!Array.isArray(data)) throw new Error();
        setCounselors((data as Employee[])
          .filter(e => e.active && roles.includes(e.role))
          .sort((a, b) => (a.displayname || a.employeeemail).localeCompare(b.displayname || b.employeeemail)));
      })
      .catch(() => { if (!cancelled) setLoadError(`Could not load the ${lead} list.`); });
    return () => { cancelled = true; };
  }, [observer, lead]);

  const usual = (usualCounselor || '').trim().toLowerCase();
  // A saved pick that is no longer an active counselor still shows, so saving doesn't silently drop it
  const savedMissing = value && !counselors.some(c => c.employeeemail.toLowerCase() === value.toLowerCase());

  return (
    <label className="block">
      <span className="text-xs text-slate-400 uppercase font-semibold tracking-wide">Covering {observer ? 'Observer' : 'Counselor'}</span>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        disabled={disabled}
        className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm disabled:opacity-50"
      >
        <option value="">{usualCounselor ? `None: ${usualCounselor} (usual ${lead})` : `None: the group's usual ${lead}`}</option>
        {counselors
          .filter(c => (c.displayname || '').trim().toLowerCase() !== usual)
          .map(c => <option key={c.employeeemail} value={c.employeeemail}>{c.displayname || c.employeeemail}</option>)}
        {savedMissing && <option value={value!}>{value}</option>}
      </select>
      <span className="block text-xs text-slate-500 mt-1">
        Pick the {lead} covering this session if the office is checking it in for them. They will be responsible for its cash on the Group Cash Deposits report.
      </span>
      {loadError && <span className="block text-xs text-red-400 mt-1">{loadError}</span>}
    </label>
  );
}
