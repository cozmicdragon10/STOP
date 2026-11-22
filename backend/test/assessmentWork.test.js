const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    amountDueToBegin, beginPaymentProblem, completeProblem, fundingProblem, noteProblem, paperworkLabel, worksOnAssessment, NOTE_MAX,
} = require('../lib/assessmentWork');
const { isCounselorAllowed } = require('../lib/counselorAccess');

test('beginning needs the fee plus any past due balance, less any credit', () => {
    assert.equal(amountDueToBegin(0, 150), 150);
    assert.equal(amountDueToBegin(40, 150), 190);
    assert.equal(amountDueToBegin(-30, 150), 120);
    assert.equal(amountDueToBegin(-500, 150), 0);
});

test('the payment must cover what is due and be checked off', () => {
    const base = { balance: 25, fee: 100, paymentConfirmed: true, clientName: 'Lee, Pat', typeName: 'DV Assessment' };
    assert.equal(beginPaymentProblem({ ...base, payment: 125 }), null);
    assert.equal(beginPaymentProblem({ ...base, payment: 200 }), null);
    assert.match(beginPaymentProblem({ ...base, payment: 100 }), /needs to pay \$125\.00 \(the DV Assessment and the past due balance\)/);
    assert.match(beginPaymentProblem({ ...base, payment: 125, paymentConfirmed: false }), /payment was received/);
    // Nothing due (a $0.00 assessment, or credit covers it): no payment and no box
    assert.equal(beginPaymentProblem({ ...base, balance: 0, fee: 0, payment: 0, paymentConfirmed: false }), null);
    assert.equal(beginPaymentProblem({ ...base, balance: -200, payment: 0, paymentConfirmed: false }), null);
});

test('a Max Debt Override lets the assessment begin owing up to the limit', () => {
    assert.equal(amountDueToBegin(25, 100, null, 100), 25);
    assert.equal(amountDueToBegin(0, 100, null, 150), 0);
    assert.equal(amountDueToBegin(200, 100, 'DHS Voucher', 150), 50);
    const base = { balance: 25, fee: 100, maxOwed: 100, clientName: 'Lee, Pat', typeName: 'DV Assessment' };
    assert.match(beginPaymentProblem({ ...base, payment: 10, paymentConfirmed: true }), /needs to pay \$25\.00.*owe up to \$100\.00/);
    assert.equal(beginPaymentProblem({ ...base, payment: 25, paymentConfirmed: true }), null);
});

test('a DHS voucher or invoice lets it begin without paying the fee, not the past due balance', () => {
    assert.equal(amountDueToBegin(40, 150, 'Invoice'), 40);
    assert.equal(amountDueToBegin(-30, 150, 'DHS Voucher'), 0);
    const base = { balance: 0, fee: 150, payment: 0, fundedBy: 'DHS Voucher', typeName: 'DV Assessment', clientName: 'Lee, Pat' };
    // Nothing to collect: no payment box needed
    assert.equal(beginPaymentProblem(base), null);
    assert.match(beginPaymentProblem({ ...base, balance: 40 }), /pay \$40\.00 of the past due balance.*DHS Voucher pays only/);
    assert.match(beginPaymentProblem({ ...base, balance: 40, payment: 40 }), /payment was received/);
    assert.equal(beginPaymentProblem({ ...base, balance: 40, payment: 40, paymentConfirmed: true }), null);
});

test('only a Business Administrator begins on a DHS voucher or invoice, with a note', () => {
    const ba = 'Business Administrator';
    assert.equal(fundingProblem({ fundedBy: null, role: 'Counselor' }), null);
    assert.match(fundingProblem({ fundedBy: 'Gift card', fundingNote: 'x', role: ba }), /DHS Voucher or Invoice/);
    assert.match(fundingProblem({ fundedBy: 'Invoice', fundingNote: 'x', role: 'Office Admin' }), /Only a Business Administrator/);
    assert.match(fundingProblem({ fundedBy: 'Invoice', fundingNote: '  ', role: ba }), /Enter a note/);
    assert.equal(fundingProblem({ fundedBy: 'Invoice', fundingNote: 'Invoice 2211, approved by J.', role: ba }), null);
});

test('BIP intakes and reinstates need their paperwork checked to complete', () => {
    assert.equal(completeProblem({ kind: 'Standard' }), null);
    assert.match(completeProblem({ kind: 'BIP Intake' }), /intake paperwork/);
    assert.match(completeProblem({ kind: 'BIP Reinstate', paperworkCompleted: false }), /Reinstatement Contract/);
    assert.equal(completeProblem({ kind: 'BIP Intake', paperworkCompleted: true }), null);
    assert.equal(paperworkLabel('BIP Reinstate'), 'BIP Reinstatement Contract signed');
});

test('notes must have text and fit', () => {
    assert.match(noteProblem('   '), /Type the note/);
    assert.equal(noteProblem('Waiting on records from the probation officer.'), null);
    assert.match(noteProblem('x'.repeat(NOTE_MAX + 1)), /up to/);
});

test('counselors work on their own assessments; admins on all; others on none', () => {
    const row = { provider: 'Pat Lee' };
    assert.equal(worksOnAssessment({ role: 'Counselor', displayname: ' pat lee ' }, row), true);
    assert.equal(worksOnAssessment({ role: 'Counselor', displayname: 'Sam Ray' }, row), false);
    assert.equal(worksOnAssessment({ role: 'Office Admin' }, row), true);
    assert.equal(worksOnAssessment({ role: 'Business Administrator' }, row), true);
    assert.equal(worksOnAssessment({ role: 'Polygrapher', displayname: 'Pat Lee' }, row), false);
    assert.equal(worksOnAssessment(null, row), false);
});

test('counselors can reach the assessment work routes', () => {
    assert.equal(isCounselorAllowed('POST', '/api/assessments/begin'), true);
    assert.equal(isCounselorAllowed('GET', '/api/assessments/in-progress'), true);
    assert.equal(isCounselorAllowed('GET', '/api/assessments/12'), true);
    assert.equal(isCounselorAllowed('POST', '/api/assessments/12/notes'), true);
    assert.equal(isCounselorAllowed('POST', '/api/assessments/12/complete'), true);
    assert.equal(isCounselorAllowed('DELETE', '/api/assessments/12'), false);
});
