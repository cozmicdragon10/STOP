import { describe, expect, it } from 'vitest';
import { groupAssignmentPayload, groupChoicesFor, joinGroupFee } from './groupAssignment';
import { bipTreatmentFee } from './soPhases';

describe('joinGroupFee', () => {
  it('sets the price list fee only when joining from no group', () => {
    expect(joinGroupFee(null, 4, 'BIP', '0')).toBe(bipTreatmentFee());
    expect(joinGroupFee(3, 4, 'BIP', '0')).toBeNull();
    expect(joinGroupFee(null, null, 'BIP', '0')).toBeNull();
  });
});

describe('groupAssignmentPayload', () => {
  it('sends the group, the joining fee, and what the screen showed', () => {
    expect(groupAssignmentPayload({ groupid: null, programtype: 'BIP', phase: '0', treatmentfee: '0.00' }, 4)).toEqual({
      groupid: 4, treatmentfee: bipTreatmentFee(), expected: { groupid: null, treatmentfee: '0.00' },
    });
  });
  it('leaves the fee alone when it already matches or the client is moving between groups', () => {
    expect(groupAssignmentPayload({ groupid: null, programtype: 'BIP', treatmentfee: bipTreatmentFee() }, 4))
      .toEqual({ groupid: 4, expected: { groupid: null } });
    expect(groupAssignmentPayload({ groupid: 3, programtype: 'BIP', treatmentfee: '10' }, 4))
      .toEqual({ groupid: 4, expected: { groupid: 3 } });
  });
});

describe('groupChoicesFor', () => {
  const groups = [
    { groupid: 1, programtype: 'BIP', active: true },
    { groupid: 2, programtype: 'SO', active: true },
    { groupid: 3, programtype: 'BIP', active: false },
    { groupid: 4, programtype: 'INDIVIDUAL', active: true },
  ];
  it('lists active groups that take the client, plus the current group', () => {
    expect(groupChoicesFor(groups, { programtype: 'BIP', groupid: null }).map(g => g.groupid)).toEqual([1, 4]);
    expect(groupChoicesFor(groups, { programtype: 'BIP', groupid: 3 }).map(g => g.groupid)).toEqual([1, 3, 4]);
  });
});
