import { describe, expect, it } from 'vitest';
import { dischargeCountText } from './clients';

describe('dischargeCountText', () => {
  it('says how many times a client has been discharged', () => {
    expect(dischargeCountText(0)).toBe('Never discharged');
    expect(dischargeCountText(1)).toBe('Discharged 1 time');
    expect(dischargeCountText(3)).toBe('Discharged 3 times');
  });
});
