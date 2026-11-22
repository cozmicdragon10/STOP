import { standardTreatmentFee } from './soPhases';
import { clientFitsGroup } from './clients';

// Joining a group (from no group) sets the treatment fee to the price list's group fee for the client's program and
// phase; an assessment's price comes from its assessment type, not this fee. Moving between groups keeps the fee.
// null: the fee stays as it is.
export const joinGroupFee = (fromGroupId: number | string | null | undefined, toGroupId: number | string | null | undefined,
  programtype?: string | null, phase?: string | null): number | null =>
  (toGroupId && !fromGroupId ? standardTreatmentFee(programtype, phase) : null);

// The groups a client can be put in: active groups that take the client's program (the current group stays listed)
export const groupChoicesFor = <G extends { groupid: number; programtype?: string | null; active?: boolean | null }>(
  groups: G[], client: { programtype?: string | null; groupid?: number | null }) =>
  groups.filter(g => (g.active !== false || g.groupid === client.groupid)
    && (clientFitsGroup(client.programtype, g.programtype) || g.groupid === client.groupid));

interface AssignClient {
  groupid?: number | null;
  programtype?: string | null;
  phase?: string | null;
  treatmentfee?: number | string | null;
}

// What assigning the client to a group sends (PATCH /clients/:id): the group, the joining fee when it applies, and the
// values the screen showed for each, so a change made on another screen meanwhile isn't silently replaced
export const groupAssignmentPayload = (client: AssignClient, groupid: number) => {
  const fee = joinGroupFee(client.groupid, groupid, client.programtype, client.phase);
  const feeChanges = fee !== null && Number(fee) !== Number(client.treatmentfee ?? NaN);
  return {
    groupid,
    ...(feeChanges ? { treatmentfee: fee } : {}),
    expected: {
      groupid: client.groupid ?? null,
      ...(feeChanges ? { treatmentfee: client.treatmentfee ?? null } : {}),
    },
  };
};
