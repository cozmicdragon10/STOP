import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it("uses the error's own message", () => {
    expect(errorMessage(new Error('Client not found.'), 'Failed.')).toBe('Client not found.');
  });

  it('falls back when the error has no message', () => {
    expect(errorMessage(new Error(''), 'Failed.')).toBe('Failed.');
  });

  it('falls back for things that are not errors', () => {
    expect(errorMessage('oops', 'Failed.')).toBe('Failed.');
    expect(errorMessage(undefined, 'Failed.')).toBe('Failed.');
    expect(errorMessage({ message: 'not an Error' }, 'Failed.')).toBe('Failed.');
  });
});
