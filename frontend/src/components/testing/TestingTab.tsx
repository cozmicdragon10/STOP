import { useRef, useState } from 'react';
import { getClientTests, submitTestResult } from '../../api';
import type { TestResult } from '../../api';
import ClientPicker from '../ClientPicker';
import { todayLocal } from '../../hooks/useGroupCheckIn';

interface TestingClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
}

interface Props {
  clients: TestingClient[];
  onSuccess: (message: string) => void;
}

const TEST_TYPES = ['SOTP Pre/Post', 'MRT Step Evaluation', 'BIP Homework Assessment', 'Cognitive Distortions Scale'];

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// Test entry for a client, with that client's test history beside it
export default function TestingTab({ clients, onSuccess }: Props) {
  const [testClient, setTestClient] = useState('');
  const [testType, setTestType] = useState(TEST_TYPES[0]);
  const [testScore, setTestScore] = useState('');
  const [testNotes, setTestNotes] = useState('');
  const [history, setHistory] = useState<TestResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Guards against a slow history response for a previous client overwriting the current one
  const historyRequest = useRef(0);

  const loadHistory = async (clientId: string) => {
    const requestId = ++historyRequest.current;
    const data = await getClientTests(Number(clientId));
    if (requestId !== historyRequest.current) return;
    setHistory(data);
  };

  const selectClient = async (clientId: string) => {
    setTestClient(clientId);
    setHistory([]);
    setError('');
    if (!clientId) return;
    try {
      await loadHistory(clientId);
    } catch (err) {
      setError(errorText(err, 'Could not load the test history.'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testClient) return;
    setSaving(true);
    setError('');
    try {
      await submitTestResult({
        client: Number(testClient),
        testType,
        score: testScore,
        notes: testNotes,
        // Local date; toISOString() is UTC and would date evening entries tomorrow
        date: todayLocal(),
      });
      onSuccess('Test result saved successfully!');
      setTestScore('');
      setTestNotes('');
      await loadHistory(testClient);
    } catch (err) {
      setError(errorText(err, 'Could not save the test result.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Test Entry</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Select Client</label>
            <ClientPicker
              clients={clients}
              value={testClient}
              onChange={selectClient}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm placeholder-slate-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Test Type</label>
            <select value={testType} onChange={(e) => setTestType(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm">
              {TEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Score / Evaluation</label>
            <input type="text" value={testScore} onChange={(e) => setTestScore(e.target.value)} placeholder="e.g. 85%, Passed, Step 4 Complete" className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Clinical Notes</label>
            <textarea value={testNotes} onChange={(e) => setTestNotes(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" placeholder="Enter notes..." />
          </div>
          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">Save Test Result</button>
        </form>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Test History</h2>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500 italic">{testClient ? 'No test results for this client yet.' : 'Select a client to view test history.'}</p>
        ) : (
          history.map(t => (
            <div key={t.testid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm space-y-1">
              <div className="flex justify-between font-semibold text-white">
                <span>{t.testtype}</span>
                <span className="text-blue-400 font-bold">{t.score}</span>
              </div>
              <p className="text-xs text-slate-400">{t.date ? new Date(t.date).toLocaleDateString() : 'No date'} —{t.notes || 'No notes'}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
