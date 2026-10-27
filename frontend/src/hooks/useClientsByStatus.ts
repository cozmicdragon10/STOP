import { useEffect, useMemo, useState } from 'react';
import { getClients } from '../api';
import { DISCHARGE_STATUSES } from '../utils/clients';

interface StatusClient {
  clientid: number;
  lastname?: string | null;
  programstatus?: string | null;
}

// Clients with a program status ('' for every client). Current clients come from the list App keeps; discharged
// clients are fetched from the server only while asked for, since they pile up over the years. They are fetched again
// whenever App's list changes, so a status change or payment made in the account shows here too.
export function useClientsByStatus<C extends StatusClient>(currentClients: C[], status: string) {
  const dischargedStatus = !status ? 'discharged' : DISCHARGE_STATUSES.includes(status) ? status : null;
  const [fetched, setFetched] = useState<{ status: string; rows: C[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dischargedStatus) return;
    let cancelled = false;
    getClients({ status: dischargedStatus })
      .then(rows => {
        if (cancelled) return;
        setFetched({ status: dischargedStatus, rows: rows as unknown as C[] });
        setError('');
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : 'Failed to load discharged clients.');
      });
    return () => { cancelled = true; };
  }, [dischargedStatus, currentClients]);

  const loaded = !dischargedStatus || fetched?.status === dischargedStatus;
  const clients = useMemo(() => {
    const current = status ? currentClients.filter(c => c.programstatus === status) : currentClients;
    if (!dischargedStatus || fetched?.status !== dischargedStatus) return current;
    // A client discharged during this session is in both lists until App's list is reloaded
    const currentIds = new Set(current.map(c => c.clientid));
    return [...current, ...fetched.rows.filter(c => !currentIds.has(c.clientid))]
      .sort((a, b) => String(a.lastname ?? '').localeCompare(String(b.lastname ?? '')));
  }, [currentClients, status, dischargedStatus, fetched]);

  return { clients, loading: !loaded && !error, error };
}
