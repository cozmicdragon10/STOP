import { useEffect, useState } from 'react';
import { getEmployees } from '../../api';

interface Employee {
  employeeemail: string;
  displayname: string | null;
  role: string;
  active: boolean;
}

interface Props {
  // The group's usual counselor (display name)
  usualCounselor: string | null | undefined;
  value: string | null;
  onChange: (email: string | null) => void;
  disabled?: boolean;
}

const COUNSELOR_ROLES = ['Counselor', 'Therapist'];

// Office Admins and Business Administrators only. When the office checks a group in, the group's usual counselor is
// responsible for its cash unless a covering counselor is picked here.
export default function CoveringCounselorPicker({ usualCounselor, value, onChange, disabled }: Props) {
  const [counselors, setCounselors] = useState<Employee[]>([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getEmployees()
      .then((data: unknown) => {
        if (cancelled) return;
        if (!Array.isArray(data)) throw new Error();
        setCounselors((data as Employee[])
          .filter(e => e.active && COUNSELOR_ROLES.includes(e.role))
          .sort((a, b) => (a.displayname || a.employeeemail).localeCompare(b.displayname || b.employeeemail)));
      })
      .catch(() => { if (!cancelled) setLoadError('Could not load the counselor list.'); });
    return () => { cancelled = true; };
  }, []);

  const usual = (usualCounselor || '').trim().toLowerCase();
  // A saved pick that is no longer an active counselor still shows, so saving doesn't silently drop it
  const savedMissing = value && !counselors.some(c => c.employeeemail.toLowerCase() === value.toLowerCase());

  return (
    <label className="block">
      <span className="text-xs text-slate-400 uppercase font-semibold tracking-wide">Covering Counselor</span>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        disabled={disabled}
        className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm disabled:opacity-50"
      >
        <option value="">{usualCounselor ? `None: ${usualCounselor} (usual counselor)` : 'None: the group\'s usual counselor'}</option>
        {counselors
          .filter(c => (c.displayname || '').trim().toLowerCase() !== usual)
          .map(c => <option key={c.employeeemail} value={c.employeeemail}>{c.displayname || c.employeeemail}</option>)}
        {savedMissing && <option value={value!}>{value}</option>}
      </select>
      <span className="block text-xs text-slate-500 mt-1">
        Pick the counselor covering this session if the office is checking it in for them. They will be responsible for its cash on the Group Cash Deposits report.
      </span>
      {loadError && <span className="block text-xs text-red-400 mt-1">{loadError}</span>}
    </label>
  );
}
