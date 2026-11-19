// A client's ID # (Clients.DOCNumber) and what kind of number it is (Clients.DocType). Not every client's number is a
// DOC number: federal clients have PACTS numbers, BIP clients often court case numbers. Mirrors frontend utils/clients.ts.
const ID_TYPES = ['DOC', 'PACTS', 'Case #', 'DHS', 'OCS'];

// The ID # as shown, with its kind in front when set: "PACTS 1423371 PB", "DOC 581422", or just the number
const idText = (client) => {
    const number = String(client?.docnumber ?? '').trim();
    if (!number) return '';
    return client.doctype ? `${client.doctype} ${number}` : number;
};

// Who referred the client (Clients.ReferredByType), with details typed beside it (Clients.ReferredBy). Mirrors
// frontend utils/clients.ts REFERRAL_TYPES.
const REFERRAL_TYPES = ['Criminal Court', 'DHS', 'Tribal', 'Self'];

// Referred By as shown: "Criminal Court - Judge Smith", "Self", or just the details
const referredByText = (client) =>
    [String(client?.referredbytype ?? '').trim(), String(client?.referredby ?? '').trim()].filter(Boolean).join(' - ');

module.exports = { ID_TYPES, idText, REFERRAL_TYPES, referredByText };
