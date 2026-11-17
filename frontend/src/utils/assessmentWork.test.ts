import { describe, expect, it } from 'vitest';
import { amountDueToBegin, daysOpenText, paperworkLabel, worksOnAssessment } from './assessmentWork';

describe('assessment work', () => {
  it('needs the fee plus any past due balance, less any credit, to begin', () => {
    expect(amountDueToBegin(0, 150)).toBe(150);
    expect(amountDueToBegin('40.00', 150)).toBe(190);
    expect(amountDueToBegin(-30, 150)).toBe(120);
    expect(amountDueToBegin(-500, 150)).toBe(0);
    expect(amountDueToBegin(null, Number.NaN)).toBe(0);
  });

  it('lets counselors work on their own assessments and admins on all', () => {
    const row = { provider: 'Pat Lee' };
    expect(worksOnAssessment({ role: 'Counselor', displayname: ' pat lee ' }, row)).toBe(true);
    expect(worksOnAssessment({ role: 'Counselor', displayname: 'Sam Ray' }, row)).toBe(false);
    expect(worksOnAssessment({ role: 'Office Admin' }, row)).toBe(true);
    expect(worksOnAssessment({ role: 'Business Administrator' }, row)).toBe(true);
    expect(worksOnAssessment({ role: 'Polygrapher', displayname: 'Pat Lee' }, row)).toBe(false);
  });

  it('labels the paperwork box and how long it has been open', () => {
    expect(paperworkLabel('BIP Reinstate')).toBe('BIP Reinstatement Contract signed');
    expect(paperworkLabel('BIP Intake')).toBe('Intake paperwork completed');
    expect(daysOpenText(0)).toBe('Begun today');
    expect(daysOpenText(1)).toBe('Open 1 day');
    expect(daysOpenText(12)).toBe('Open 12 days');
  });
});
