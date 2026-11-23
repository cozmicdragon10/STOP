import { createContext, useCallback, useContext, useMemo } from 'react';
import { nameWithCredentials } from '../utils/credentials';

export interface EmployeeRow {
  employeeemail: string;
  displayname?: string | null;
  role?: string | null;
  active?: boolean | null;
  // A counselor's license credentials, e.g. "LPC"
  credentials?: string | null;
}

// Filled by EmployeeLabelProvider (components/EmployeeLabelProvider.tsx) with App's employee list
export const EmployeesContext = createContext<EmployeeRow[]>([]);

// Turns the email saved on a record (who entered, edited, or approved it) into "Display Name (Role)". Anything that
// isn't a known employee's email (an older display name, "Unknown") is shown as it was saved.
export function useEmployeeLabel() {
  const employees = useContext(EmployeesContext);
  const byEmail = useMemo(() => new Map(employees.map(e => [e.employeeemail.trim().toLowerCase(), e])), [employees]);
  return useCallback((value?: string | null) => {
    if (!value) return '';
    const e = byEmail.get(value.trim().toLowerCase());
    if (!e) return value;
    const name = e.displayname?.trim() || e.employeeemail;
    return e.role ? `${name} (${e.role})` : name;
  }, [byEmail]);
}

// How a counselor's name prints on reports: "Belinda Harris, LPC, LADC-MH" (see utils/credentials.ts)
export function useCounselorPrintName() {
  const employees = useContext(EmployeesContext);
  return useCallback((nameOrEmail?: string | null) => nameWithCredentials(nameOrEmail, employees), [employees]);
}
