// Clients on an open group check-in who were handed a printed attendance receipt (entries with receiptPrinted set by the
// frontend when the receipt prints). The attendance saved when the group closes must match that receipt, so such a client
// can't be removed from the session, their fee and check-in payment can't change, and the open check-in can't be discarded.

const clientIdOf = (entry) => Number(entry?.client?.clientid ?? entry?.client);
const cents = (n) => Math.round(Number(n || 0) * 100);
const nameOf = (entry) => (entry?.client?.lastname
    ? `${entry.client.lastname}, ${entry.client.firstname}`
    : `Client ID ${clientIdOf(entry)}`);

const printedEntries = (entries) => (Array.isArray(entries) ? entries : []).filter(e => e && e.receiptPrinted);

// Fee, check-in payment, and payment method as printed. Open sheet entries use fee/payment/paymentMethod/cardPaid; the
// batch sent to close the group uses groupFee/accountPaid/paymentMethod and has no card payment (already on the account).
const sheetTerms = (e) => ({ fee: cents(e.fee), paid: cents(e.payment), method: cents(e.payment) > 0 ? e.paymentMethod : null, card: cents(e.cardPaid) });
const batchTerms = (e) => ({ fee: cents(e.groupFee), paid: cents(e.accountPaid), method: cents(e.accountPaid) > 0 ? e.paymentMethod : null });

// Returns an error message when `next` leaves out or changes a client whose receipt was printed in `saved`, or null.
// closing: next is the batch that closes the group rather than a re-saved open sheet.
function printedReceiptProblem(saved, next, { closing = false } = {}) {
    const byClient = new Map((Array.isArray(next) ? next : []).map(e => [clientIdOf(e), e]));
    for (const printed of printedEntries(saved)) {
        const kept = byClient.get(clientIdOf(printed));
        const name = nameOf(printed);
        if (!kept) {
            return `An attendance receipt was printed for ${name}, so they can't be removed from this group session.`;
        }
        const was = sheetTerms(printed);
        const now = closing ? batchTerms(kept) : sheetTerms(kept);
        if (was.fee !== now.fee || was.paid !== now.paid || was.method !== now.method || (!closing && was.card !== now.card)) {
            return `An attendance receipt was printed for ${name}, so their fee and check-in payment can't change in this group session.`;
        }
    }
    return null;
}

// Keeps the printed mark on clients already printed, whatever an older screen sends back
const keepPrintedMarks = (saved, next) => {
    const printedIds = new Set(printedEntries(saved).map(clientIdOf));
    return next.map(e => (printedIds.has(clientIdOf(e)) ? { ...e, receiptPrinted: true } : e));
};

module.exports = { printedEntries, printedReceiptProblem, keepPrintedMarks };
