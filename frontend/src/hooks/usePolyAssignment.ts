import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { assignPolygraphSlot, getClients, getPolygraphSlots } from '../api';
import { POLY_VOUCHER_MAX, polySchedulingNeeds } from '../utils/polygraph';
import type { SlotChoices } from '../components/polygraph/PolySchedule';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- client rows are untyped throughout App
type ClientRow = any;

interface Options {
  role: string;
  userEmail: string;
  clients: ClientRow[];
  setClients: Dispatch<SetStateAction<ClientRow[]>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- slot rows are untyped throughout App
  setPolySlots: Dispatch<SetStateAction<any[]>>;
  // Called with the reloaded clients after a booking is saved (the account drawer refreshes from them)
  onAssigned: (freshClients: ClientRow[]) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export interface PolyPaymentPrompt { client: ClientRow; amountDue: number; notice: string }
export interface WaitBypassPrompt { slotId: number; clientName: string; lastPolyDate: string; earliestDate: string }

// Assigning clients to polygraph slots, shared by the Poly Schedule cards and the client account's Schedule Polygraph.
// Booking goes: choices on the slot → confirmation box → save. A client short on poly fee vouchers or owing a balance
// is offered a payment first; a booking inside the post-NDI waiting period can be bypassed by a Business Administrator.
export function usePolyAssignment({ role, userEmail, clients, setClients, setPolySlots, onAssigned, onSuccess, onError }: Options) {
  // The client, poly type, and comment picked for each slot
  const [slotAssignments, setSlotAssignments] = useState<{ [slotId: number]: string }>({});
  const [slotTypes, setSlotTypes] = useState<{ [slotId: number]: string }>({});
  const [slotComments, setSlotComments] = useState<{ [slotId: number]: string }>({});
  // Slot awaiting the assignment confirmation box
  const [pendingSlotId, setPendingSlotId] = useState<number | null>(null);
  // Payment prompt for a client who lacks the poly fee vouchers needed to be scheduled
  const [paymentPrompt, setPaymentPrompt] = useState<PolyPaymentPrompt | null>(null);
  // Business Administrator prompt to schedule inside the post-NDI waiting period; the box must be ticked to bypass
  const [waitBypassPrompt, setWaitBypassPrompt] = useState<WaitBypassPrompt | null>(null);
  const [waitBypassConfirmed, setWaitBypassConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  const choices: SlotChoices = {
    clientOf: (slotId) => slotAssignments[slotId] || '',
    typeOf: (slotId) => slotTypes[slotId] || 'Maintenance',
    commentOf: (slotId) => slotComments[slotId] || '',
    setClient: (slotId, clientId) => setSlotAssignments(prev => ({ ...prev, [slotId]: clientId })),
    setType: (slotId, type) => setSlotTypes(prev => ({ ...prev, [slotId]: type })),
    setComment: (slotId, comment) => setSlotComments(prev => ({ ...prev, [slotId]: comment })),
  };

  // Offers one payment covering what blocks scheduling: the rest of the poly fee first (which fills the vouchers),
  // then the account balance. Short vouchers with nothing owed on the poly fee must be fixed in Edit Info.
  const promptPayment = (client: ClientRow) => {
    const name = `${client.firstname} ${client.lastname}`;
    const { vouchers, polyFeePaid, polyFee, short, polyDue, balanceDue } = polySchedulingNeeds(client);
    if (short && polyDue <= 0) {
      onError(`${name} has ${vouchers}/${POLY_VOUCHER_MAX} poly fee vouchers but nothing is owed on the poly fee. Correct the vouchers in the client's Edit Info.`);
      return;
    }
    const needs = [
      short && `${POLY_VOUCHER_MAX} poly fee vouchers (has ${vouchers}/${POLY_VOUCHER_MAX}; poly fee paid $${polyFeePaid.toFixed(2)} / $${polyFee.toFixed(2)}, $${polyDue.toFixed(2)} remaining)`,
      balanceDue > 0 && `an account balance of $0.00 or better (owes $${balanceDue.toFixed(2)})`,
    ].filter(Boolean);
    setPaymentPrompt({
      client,
      amountDue: polyDue + balanceDue,
      notice: `Scheduling ${name} for a polygraph needs ${needs.join(' and ')}. `
        + `Paying $${(polyDue + balanceDue).toFixed(2)} covers ${polyDue > 0 && balanceDue > 0 ? 'both' : 'it'}`
        + (polyDue > 0 ? '; the poly fee is paid first.' : '.'),
    });
  };

  // Opens the confirmation box; the assignment is only saved when it is accepted.
  // clientId is passed when the slot's choice was set in the same click (scheduling from a client's account).
  const openAssignConfirm = (slotId: number, clientId = slotAssignments[slotId]) => {
    if (!clientId) {
      onError('Please select a client to assign to this slot.');
      return;
    }
    const client = clients.find(c => String(c.clientid) === clientId);
    if (client && !polySchedulingNeeds(client).met) {
      promptPayment(client);
      return;
    }
    setPendingSlotId(slotId);
  };

  // Schedule Polygraph on a client's account: fills the same per-slot choices the Poly Schedule uses, so the
  // confirmation, payment, and waiting-period prompts work unchanged
  const scheduleFromAccount = (slotId: number, clientId: string, type: string, comment: string) => {
    choices.setClient(slotId, clientId);
    choices.setType(slotId, type);
    choices.setComment(slotId, comment);
    openAssignConfirm(slotId, clientId);
  };

  const assign = async (slotId: number, bypassWaitPeriod = false) => {
    if (role !== 'Business Administrator') {
      onError('Only Business Administrators can assign polygraph slots to clients.');
      return;
    }
    const clientId = slotAssignments[slotId];
    const assignedType = slotTypes[slotId] || 'Maintenance';
    if (!clientId) {
      onError('Please select a client to assign to this slot.');
      return;
    }

    setSaving(true);
    try {
      const res = await assignPolygraphSlot(slotId, Number(clientId), assignedType, userEmail, (slotComments[slotId] || '').trim(), bypassWaitPeriod);
      const client = clients.find(c => String(c.clientid) === clientId);
      if (res?.code === 'POLY_TOO_SOON' && client) {
        // Only Business Administrators reach this point; offer the override instead of a plain refusal
        setWaitBypassConfirmed(false);
        setWaitBypassPrompt({
          slotId,
          clientName: `${client.lastname}, ${client.firstname}`,
          lastPolyDate: res.lastPolyDate,
          earliestDate: res.earliestDate,
        });
      } else if (res?.code === 'POLY_SCHEDULING_REQUIREMENTS' && client) {
        // The server's figures are current; refresh the client and ask for the payment
        const updated = { ...client, polyfeevoucher: res.vouchers, polyfeepaid: res.polyFeePaid, polyfee: res.polyFee, accountbalance: res.accountBalance };
        setClients(prev => prev.map(c => c.clientid === client.clientid ? updated : c));
        promptPayment(updated);
      } else if (res?.error) {
        onError(res.error);
      } else {
        setSlotComments(prev => ({ ...prev, [slotId]: '' }));
        onSuccess(`Assigned ${assignedType} Polygraph slot to ${client ? client.lastname + ', ' + client.firstname : 'Client'}!`);
        // Reloaded from the server: the vouchers and paid-in-full poly fee are spent, and spending the last fill of a
        // poly fee override puts the regular poly fee back, which only the server knows about
        const [freshSlots, freshClients] = await Promise.all([getPolygraphSlots(), getClients()]);
        setPolySlots(freshSlots);
        setClients(freshClients);
        onAssigned(freshClients);
      }
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Failed to assign client to slot.');
    } finally {
      setSaving(false);
    }
  };

  return {
    choices, openAssignConfirm, scheduleFromAccount, assign, saving,
    pendingSlotId, setPendingSlotId,
    paymentPrompt, setPaymentPrompt,
    waitBypassPrompt, setWaitBypassPrompt, waitBypassConfirmed, setWaitBypassConfirmed,
  };
}

export type PolyAssignment = ReturnType<typeof usePolyAssignment>;
