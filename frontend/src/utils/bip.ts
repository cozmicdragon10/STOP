// Why a BIP client can't be checked into group yet, as sent by the server (BipCheckInBlock): 'intake' when no BIP Intake or
// DV Assessment is on record (here or at another provider); 'our-intake' when they were discharged after an intake done at
// another provider, so our own BIP Intake or DV Assessment is needed; 'reinstate' when they were discharged since their
// last completed BIP intake or reinstate. Mirrors bipCheckInBlockMessage in backend/lib/sql.js.
// 'absence-streak' / 'absence-total': the client missed 3 meetings in a row, or has 7 open absences, and has a week to make
// one up at a different group (lib/bipAbsences.js). Only their primary group's sheet is blocked. 'absence-failed': that
// make-up week passed, so every group's sheet is blocked.
export type BipCheckInBlock = 'intake' | 'our-intake' | 'reinstate' | 'absence-streak' | 'absence-total' | 'absence-failed' | null | undefined;

export const bipCheckInBlockMessage = (block: BipCheckInBlock, name: string): string => {
  if (block === 'intake') {
    return `${name} is a BIP client with no BIP Intake or DV Assessment on record. Complete one on the Assessments tab (or record one done at another provider on the client's Information tab) before group check-in.`;
  }
  if (block === 'our-intake') {
    return `${name} was discharged after an intake done at another provider. Complete our BIP Intake or DV Assessment on the Assessments tab before group check-in.`;
  }
  if (block === 'absence-streak') {
    return `${name} has missed 3 group meetings in a row. Check-in at their primary group is blocked until they make up an absence at a different group.`;
  }
  if (block === 'absence-total') {
    return `${name} has 7 open absences. Check-in at their primary group is blocked until they make up an absence at a different group.`;
  }
  if (block === 'absence-failed') {
    return `${name} reached the BIP absence limit and the week to make up an absence has passed. They can't check in to any group; a Business Administrator can excuse an absence or discharge them.`;
  }
  return `${name} was discharged and reactivated. Complete the BIP Reinstate assessment on the Assessments tab before group check-in.`;
};

export const bipCheckInBlockLabel = (block: BipCheckInBlock): string => {
  if (block === 'intake') return 'Needs BIP intake';
  if (block === 'our-intake') return 'Needs our BIP intake';
  if (block === 'absence-streak') return 'Absent 3 in a row';
  if (block === 'absence-total') return 'Absent 7 times';
  if (block === 'absence-failed') return 'Locked: absences';
  return 'Needs BIP reinstate';
};
