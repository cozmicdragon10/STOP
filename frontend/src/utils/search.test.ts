import { describe, expect, it } from 'vitest';
import { matchesAllWords } from './search';

describe('matchesAllWords', () => {
  const row = ['Vance, Malik', 'Sexual History', 'Sapulpa', '11/2/2026 @ 10:00 AM', 'James Kelly'];

  it('matches everything when the search is blank', () => {
    expect(matchesAllWords('', row)).toBe(true);
    expect(matchesAllWords('   ', row)).toBe(true);
  });

  it('needs every word, in any order and any case, across any fields', () => {
    expect(matchesAllWords('kelly SAPULPA', row)).toBe(true);
    expect(matchesAllWords('11/2 vance', row)).toBe(true);
    expect(matchesAllWords('kelly ada', row)).toBe(false);
  });

  it('skips empty fields', () => {
    expect(matchesAllWords('null', ['Okc', null, undefined, ''])).toBe(false);
  });
});
