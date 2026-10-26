// Why a BIP client can't be checked into group yet, as sent by the server (BipCheckInBlock): 'intake' when no BIP Intake or
// DV Assessment is on record (here or at another provider); 'our-intake' when they were discharged after an intake done at
// another provider, so our own BIP Intake or DV Assessment is needed; 'reinstate' when they were discharged since their
// last completed BIP intake or reinstate. Mirrors bipCheckInBlockMessage in backend/server.js.
export type BipCheckInBlock = 'intake' | 'our-intake' | 'reinstate' | null | undefined;

export const bipCheckInBlockMessage = (block: BipCheckInBlock, name: string): string => (block === 'intake'
  ? `${name} is a BIP client with no BIP Intake or DV Assessment on record. Complete one on the Assessments & Individuals tab (or record one done at another provider on the client's Information tab) before group check-in.`
  : block === 'our-intake'
    ? `${name} was discharged after an intake done at another provider. Complete our BIP Intake or DV Assessment on the Assessments & Individuals tab before group check-in.`
    : `${name} was discharged and reactivated. Complete the BIP Reinstate assessment on the Assessments & Individuals tab before group check-in.`);

export const bipCheckInBlockLabel = (block: BipCheckInBlock): string =>
  (block === 'intake' ? 'Needs BIP intake' : block === 'our-intake' ? 'Needs our BIP intake' : 'Needs BIP reinstate');
