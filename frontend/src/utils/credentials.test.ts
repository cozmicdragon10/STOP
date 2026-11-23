import { describe, expect, it } from 'vitest';
import { findStaff, nameWithCredentials, withCredentials } from './credentials';

const employees = [
  { employeeemail: 'bharris@example.com', displayname: 'Belinda Harris', active: true, credentials: 'LPC, LADC-MH' },
  { employeeemail: 'pdoe@example.com', displayname: 'Pat Doe', active: true, credentials: '' },
  { employeeemail: 'old@example.com', displayname: 'Sam Lee', active: false, credentials: 'LPC-C' },
  { employeeemail: 'new@example.com', displayname: 'Sam Lee', active: true, credentials: 'LPC' },
];

describe('withCredentials', () => {
  it('puts the credentials after the name', () => {
    expect(withCredentials('Belinda Harris', 'LPC, LADC-MH')).toBe('Belinda Harris, LPC, LADC-MH');
    expect(withCredentials(' Pat Doe ', ' LPC ')).toBe('Pat Doe, LPC');
  });
  it('is just the name without credentials, and empty without a name', () => {
    expect(withCredentials('Pat Doe', null)).toBe('Pat Doe');
    expect(withCredentials('Pat Doe', ' ')).toBe('Pat Doe');
    expect(withCredentials(null, 'LPC')).toBe('');
  });
});

describe('nameWithCredentials', () => {
  it('finds the counselor by display name, ignoring case and spaces', () => {
    expect(nameWithCredentials(' belinda harris ', employees)).toBe('Belinda Harris, LPC, LADC-MH');
  });
  it('finds the counselor by account email and prints their name, not the email', () => {
    expect(nameWithCredentials('BHarris@example.com', employees)).toBe('Belinda Harris, LPC, LADC-MH');
  });
  it('prints just the name for a counselor with no credentials or no account', () => {
    expect(nameWithCredentials('Pat Doe', employees)).toBe('Pat Doe');
    expect(nameWithCredentials('Someone Else', employees)).toBe('Someone Else');
  });
  it('prints nothing for an email that matches no account, or no name', () => {
    expect(nameWithCredentials('nobody@example.com', employees)).toBe('');
    expect(nameWithCredentials(null, employees)).toBe('');
  });
  it('prefers the active account when two share a name', () => {
    expect(findStaff('Sam Lee', employees)?.employeeemail).toBe('new@example.com');
    expect(nameWithCredentials('Sam Lee', employees)).toBe('Sam Lee, LPC');
  });
});
