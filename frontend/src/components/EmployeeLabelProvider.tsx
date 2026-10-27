import type { ReactNode } from 'react';
import { EmployeesContext } from '../hooks/useEmployeeLabel';
import type { EmployeeRow } from '../hooks/useEmployeeLabel';

// Gives the pages below it the employee list, so useEmployeeLabel can show a stored email as the person's name
export default function EmployeeLabelProvider({ employees, children }: { employees: EmployeeRow[]; children: ReactNode }) {
  return <EmployeesContext.Provider value={employees}>{children}</EmployeesContext.Provider>;
}
