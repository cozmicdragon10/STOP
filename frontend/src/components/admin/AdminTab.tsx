import { useState } from 'react';
import { Activity, Moon, PlusCircle, Sun } from 'lucide-react';
import { addEmployee, getEmployees, getSystemLogs, updateEmployee } from '../../api';
import type { SystemLog } from '../../api';
import SessionPriceList from '../sessions/SessionPriceList';
import { sortedUnique } from '../../utils/filters';
import { useTheme } from '../../hooks/useTheme';

interface Employee {
  employeeemail: string;
  displayname: string | null;
  role: string;
  active?: boolean | null;
}

interface Props {
  user: { employeeemail: string; role: string };
  // Shared with the rest of the app (examiner names, counselor pickers), so App keeps the list
  employees: Employee[];
  onEmployeesChanged: (employees: Employee[]) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const ROLES = ['Office Admin', 'Business Administrator', 'Counselor', 'Polygrapher'];
// New accounts get this location; it isn't editable here
const NEW_ACCOUNT_LOCATION = 'Oklahoma City';

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// User accounts (Business Administrators create and edit them), the system audit log, and session prices
export default function AdminTab({ user, employees, onEmployeesChanged, onSuccess, onError }: Props) {
  const isBusinessAdmin = user.role === 'Business Administrator';
  // Saved per browser, not per account
  const { theme, toggleTheme } = useTheme();

  // The account form stays closed until New User or an account's Edit opens it
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [empEmail, setEmpEmail] = useState('');
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('Counselor');
  // Email of the account being edited, or null when adding a new one
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [empActive, setEmpActive] = useState(true);
  const [empPassword, setEmpPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const [accountFilter, setAccountFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [empSearch, setEmpSearch] = useState('');
  // '' shows every user type
  const [empRoleFilter, setEmpRoleFilter] = useState('');

  // System audit logs stay collapsed until requested, and are fetched fresh each time they are shown
  const [showSystemLogs, setShowSystemLogs] = useState(false);
  const [systemLogs, setSystemLogs] = useState<SystemLog[] | null>(null);
  const [logsError, setLogsError] = useState('');

  const inAccountFilter = (e: Employee) => accountFilter === 'all' || (accountFilter === 'active' ? e.active !== false : e.active === false);
  const visibleEmployees = employees.filter(e => inAccountFilter(e)
    && (!empRoleFilter || e.role === empRoleFilter)
    && (empSearch.trim() === '' || `${e.displayname} ${e.employeeemail} ${e.role}`.toLowerCase().includes(empSearch.toLowerCase())));

  const resetEmployeeForm = () => {
    setShowEmployeeForm(false);
    setEditingEmail(null);
    setEmpEmail('');
    setEmpName('');
    setEmpRole('Counselor');
    setEmpActive(true);
    setEmpPassword('');
  };

  const startEditEmployee = (emp: Employee) => {
    setShowEmployeeForm(true);
    setEditingEmail(emp.employeeemail);
    setEmpEmail(emp.employeeemail);
    setEmpName(emp.displayname || '');
    setEmpRole(emp.role || 'Counselor');
    setEmpActive(emp.active !== false);
    setEmpPassword('');
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingEmail) {
        await updateEmployee(editingEmail, { displayName: empName, role: empRole, active: empActive, updatedBy: user.employeeemail, password: empPassword });
        onSuccess(empPassword ? 'Account updated and password changed!' : 'Account updated successfully!');
      } else {
        await addEmployee({
          employeeEmail: empEmail,
          displayName: empName,
          role: empRole,
          location: NEW_ACCOUNT_LOCATION,
          active: true,
          password: empPassword
        });
        onSuccess('Employee account created successfully!');
      }
      resetEmployeeForm();
      const updated = await getEmployees();
      if (Array.isArray(updated)) onEmployeesChanged(updated);
    } catch (err) {
      onError(errorText(err, 'Error saving account.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleSystemLogs = async () => {
    if (showSystemLogs) {
      setShowSystemLogs(false);
      return;
    }
    setShowSystemLogs(true);
    setSystemLogs(null);
    setLogsError('');
    try {
      setSystemLogs(await getSystemLogs());
    } catch (err) {
      setLogsError(errorText(err, 'Failed to load the system logs.'));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
        <div className="flex justify-between items-center gap-3 border-b border-slate-800 pb-3">
          <h2 className="text-lg font-bold text-white">User Management</h2>
          {isBusinessAdmin && !showEmployeeForm && (
            <button type="button" onClick={() => { resetEmployeeForm(); setShowEmployeeForm(true); }} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
              <PlusCircle size={14} /> New User
            </button>
          )}
        </div>
        {/* Only Business Administrators can create or edit accounts */}
        {!isBusinessAdmin && (
          <p className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded p-3">
            Only Business Administrators can create or edit accounts.
          </p>
        )}
        {isBusinessAdmin && showEmployeeForm && (
        <form onSubmit={handleSaveEmployee} className="space-y-3 bg-slate-950/50 border border-slate-800 rounded-lg p-4">
          <p className="text-sm font-semibold text-white">{editingEmail ? 'Edit Account' : 'New User'}</p>
          {editingEmail && <p className="text-xs text-blue-400">Editing {editingEmail}. Email can't be changed.</p>}
          <input type="email" value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} disabled={editingEmail !== null} placeholder="Employee Email" className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm disabled:opacity-50" required />
          <input type="text" value={empName} onChange={(e) => setEmpName(e.target.value)} placeholder="Full Display Name" className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required />
          <input type="password" value={empPassword} onChange={(e) => setEmpPassword(e.target.value)} autoComplete="new-password" placeholder={editingEmail ? 'New password (leave blank to keep current)' : 'Password'} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required={editingEmail === null} />
          <select value={empRole} onChange={(e) => setEmpRole(e.target.value)} disabled={editingEmail === user.employeeemail} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm disabled:opacity-50">
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {editingEmail && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={empActive} onChange={(e) => setEmpActive(e.target.checked)} disabled={editingEmail === user.employeeemail} className="rounded accent-blue-500 disabled:opacity-50" />
              Active (inactive accounts cannot log in)
            </label>
          )}
          {editingEmail === user.employeeemail && (
            <p className="text-xs text-slate-500">You can change your own name here, but not your own role or active status.</p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded text-xs">{editingEmail ? 'Save Changes' : 'Create User'}</button>
            <button type="button" onClick={resetEmployeeForm} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-4 py-2 rounded text-xs">Cancel</button>
          </div>
        </form>
        )}

        <div className="space-y-2 pt-4">
          <div className="flex justify-between items-center gap-3">
            <p className="text-xs text-slate-400 font-semibold uppercase">System Accounts</p>
            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
              {(['active', 'inactive', 'all'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAccountFilter(f)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition ${accountFilter === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {f === 'active' ? 'Active' : f === 'inactive' ? 'Inactive' : 'All'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="search"
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-xs placeholder-slate-500"
            />
            <select
              value={empRoleFilter}
              onChange={(e) => setEmpRoleFilter(e.target.value)}
              aria-label="Filter by user type"
              className={`shrink-0 bg-slate-950 border rounded px-2.5 text-xs ${empRoleFilter ? 'border-blue-500 text-white' : 'border-slate-700 text-slate-300'}`}
            >
              <option value="">All User Types</option>
              {sortedUnique(employees.map(e => e.role)).map(r => (
                <option key={r} value={r}>{r} ({employees.filter(e => e.role === r && inAccountFilter(e)).length})</option>
              ))}
            </select>
          </div>
          {visibleEmployees.map(e => (
            <div key={e.employeeemail} className={`bg-slate-950 border p-3 rounded flex justify-between items-center gap-3 text-xs ${editingEmail === e.employeeemail ? 'border-blue-500' : 'border-slate-800'}`}>
              <div className="min-w-0">
                <p className="font-semibold text-white truncate">{e.displayname}</p>
                <p className="text-slate-400 truncate">{e.employeeemail}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {e.active === false && <span className="bg-slate-700/50 text-slate-400 px-2 py-0.5 rounded font-semibold">Inactive</span>}
                <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded font-semibold">{e.role}</span>
                {isBusinessAdmin && (
                  <button type="button" onClick={() => startEditEmployee(e)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded font-semibold">Edit</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
        <div className="flex justify-between items-center gap-3 border-b border-slate-800 pb-3">
          <h2 className="text-lg font-bold text-white">System Audit & Activity Logs</h2>
          <button type="button" onClick={toggleSystemLogs} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded font-semibold text-xs shrink-0"><Activity size={14} /> {showSystemLogs ? 'Hide Logs' : 'Show Logs'}</button>
        </div>
        {showSystemLogs && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {logsError && <p className="text-xs text-red-400">{logsError}</p>}
          {!logsError && systemLogs === null && <p className="text-xs text-slate-500">Loading…</p>}
          {systemLogs?.map(l => (
            <div key={l.logid} className="bg-slate-950 border border-slate-800 p-3 rounded text-xs space-y-1">
              <div className="flex justify-between text-slate-400"><span>{l.useremail}</span><span>{new Date(l.timestamp).toLocaleString()}</span></div>
              <p className="text-white font-medium">{l.action}</p>
              <p className="text-slate-400">{l.details}</p>
            </div>
          ))}
        </div>
        )}
      </div>

      <SessionPriceList userEmail={user.employeeemail} canEdit={isBusinessAdmin} onSuccess={onSuccess} />

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4 self-start">
        <div className="flex justify-between items-center gap-3 border-b border-slate-800 pb-3">
          <h2 className="text-lg font-bold text-white">Appearance</h2>
          <button
            type="button"
            onClick={toggleTheme}
            title="Click to switch theme"
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded font-semibold text-xs shrink-0"
          >
            {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />} {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
          </button>
        </div>
        <p className="text-xs text-slate-400">Click the button to switch between dark and light mode. Your choice is remembered on this computer.</p>
      </div>
    </div>
  );
}
