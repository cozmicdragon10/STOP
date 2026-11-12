// A client's ID # (Clients.DOCNumber) and what kind of number it is (Clients.DocType). Not every client's number is a
// DOC number: federal clients have PACTS numbers, BIP clients often court case numbers. Mirrors frontend utils/clients.ts.
const ID_TYPES = ['DOC', 'PACTS', 'Case #', 'DHS', 'OCS'];

// The ID # as shown, with its kind in front when set: "PACTS 1423371 PB", "DOC 581422", or just the number
const idText = (client) => {
    const number = String(client?.docnumber ?? '').trim();
    if (!number) return '';
    return client.doctype ? `${client.doctype} ${number}` : number;
};

module.exports = { ID_TYPES, idText };
