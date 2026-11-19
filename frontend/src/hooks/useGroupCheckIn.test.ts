import { describe, expect, it } from 'vitest';
import { byClientName, sortEntriesByName } from './useGroupCheckIn';
import type { ClientRecord, SessionEntry } from './useGroupCheckIn';

const client = (clientid: number, lastname: string, firstname: string): ClientRecord => ({ clientid, lastname, firstname });
const entry = (c: ClientRecord): SessionEntry => ({
  client: c, fee: 0, payment: 0, paymentMethod: 'Cash', cardPaid: 0, balance: 0, voucher: false, comments: '',
});

describe('check-in name order', () => {
  it('sorts by last name, then first name, ignoring case', () => {
    const sorted = [
      client(1, 'smith', 'Zoe'),
      client(2, 'Adams', 'Bob'),
      client(3, 'Smith', 'Anna'),
      client(4, 'brown', 'Carl'),
    ].sort(byClientName);
    expect(sorted.map(c => c.clientid)).toEqual([2, 4, 3, 1]);
  });

  it('sorts attendance sheet entries by client name without changing the original list', () => {
    const entries = [entry(client(1, 'Young', 'Al')), entry(client(2, 'Allen', 'Di'))];
    expect(sortEntriesByName(entries).map(e => e.client.clientid)).toEqual([2, 1]);
    expect(entries.map(e => e.client.clientid)).toEqual([1, 2]);
  });
});
