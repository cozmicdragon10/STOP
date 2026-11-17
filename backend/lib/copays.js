// Federal clients' copays (Clients.GroupCopay, IndividualCopay, PolyCopay; migration 081). A federal client pays the
// copay for a service instead of its regular fee, or nothing when it is blank or $0.00. They can owe any amount unless
// a Max Debt Override is set, which caps how much a copay charge can leave them owing.
const { logClientChange } = require('./changeLog');
const { moneyText } = require('./moneyFields');

// [request/row field, label] for each copay, in the order Edit Info shows them
const COPAY_FIELDS = [['groupcopay', 'Group Copay'], ['individualcopay', 'Individual Copay'], ['polycopay', 'Polygraph Copay']];

const copayText = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2));

// What a federal client's polygraph booking needs: { copay, amountDue } where amountDue is the payment needed first so
// that charging the copay stays within a Max Debt Override (0 when none is set or nothing is charged). balance uses the
// stored sign (positive = owes). Mirrors federalPolyNeeds in frontend/src/utils/polygraph.ts.
const federalPolyNeeds = (polyCopay, balance, maxOwed) => {
    const copay = Math.round((Number(polyCopay) || 0) * 100) / 100;
    const cap = Number(maxOwed) || 0;
    const over = copay > 0 && cap > 0 ? Number(balance || 0) + copay - cap : 0;
    return { copay, amountDue: Math.max(0, Math.round(over * 100) / 100) };
};

// Moves a client's account balance by amount (positive: a charge, negative: a credit back), with its ledger row and a
// change log entry. Takes the caller's transaction client, which must already hold the client row locked.
const postCopay = async (db, { clientId, amount, comments, changedBy }) => {
    const before = Number((await db.query('SELECT AccountBalance FROM Clients WHERE ClientId = $1', [clientId])).rows[0].accountbalance || 0);
    const after = Math.round((before + amount) * 100) / 100;
    await db.query('UPDATE Clients SET AccountBalance = $1 WHERE ClientId = $2', [after, clientId]);
    await db.query(
        `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, EnteredBy)
         VALUES ($1, NOW(), $2, $3, 'Polygraph Copay', $4, $5, $6)`,
        // A credit back is an Adjustment: it lowers what is owed without being a payment (cash reports leave it out)
        [clientId, amount >= 0 ? 'Charge' : 'Adjustment', Math.abs(amount), after, comments, changedBy || null]
    );
    await logClientChange(db, {
        clientId, changedBy, changeType: 'Polygraph Copay',
        oldValue: moneyText('accountbalance', before), newValue: moneyText('accountbalance', after), details: comments,
    });
    return after;
};

module.exports = { COPAY_FIELDS, copayText, federalPolyNeeds, postCopay };
