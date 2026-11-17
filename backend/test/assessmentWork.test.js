const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    amountDueToBegin, beginPaymentProblem, completeProblem, noteProblem, paperworkLabel, worksOnAssessment, NOTE_MAX,
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
    // A $0.00 assessment with nothing owed begins with no payment, but still needs the box
    assert.equal(beginPaymentProblem({ ...base, balance: 0, fee: 0, payment: 0 }), null);
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
