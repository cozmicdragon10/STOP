import { describe, expect, it } from 'vitest';
import { chipsInOrder } from './calendar';

describe('chipsInOrder', () => {
  it('puts the picked entries first by time, then the rest as given', () => {
    const items = [
      { name: 'Group A', sort: '17:00', assessment: false },
      { name: 'Group B', sort: '09:00', assessment: false },
      { name: 'Assessment 2 PM', sort: '14:00', assessment: true },
      { name: 'Group C', sort: '18:00', assessment: false },
      { name: 'Assessment 10 AM', sort: '10:00', assessment: true },
    ];
    expect(chipsInOrder(items, i => i.assessment).map(i => i.name)).toEqual([
      'Assessment 10 AM', 'Assessment 2 PM', 'Group A', 'Group B', 'Group C',
    ]);
  });

  it('leaves a day with no picked entries as it was', () => {
    const items = [{ sort: '17:00', n: 1 }, { sort: '09:00', n: 2 }];
    expect(chipsInOrder(items, () => false)).toEqual(items);
  });
});
