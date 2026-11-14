import { describe, expect, it } from 'vitest';
import { DEVICE_NOTE_MAX, accessRequestError, describeUserAgent, deviceScreen } from './deviceAccess';

describe('access request checks', () => {
  const ok = { name: 'Jane Doe', email: 'jane@office.gov', note: 'Work laptop for field visits' };

  it('accepts a complete request', () => {
    expect(accessRequestError(ok)).toBe('');
  });

  it('needs a real-looking email', () => {
    expect(accessRequestError({ ...ok, email: 'jane' })).toMatch(/email/);
    expect(accessRequestError({ ...ok, email: '   ' })).toMatch(/email/);
  });

  it('needs a name', () => {
    expect(accessRequestError({ ...ok, name: '  ' })).toMatch(/name/);
  });

  it('allows an empty note, and a note up to the limit', () => {
    expect(accessRequestError({ ...ok, note: '' })).toBe('');
    expect(accessRequestError({ ...ok, note: 'x'.repeat(DEVICE_NOTE_MAX) })).toBe('');
    expect(accessRequestError({ ...ok, note: 'x'.repeat(DEVICE_NOTE_MAX + 1) })).toMatch(/300/);
  });
});

describe('device screens', () => {
  it('shows the login only to an approved device', () => {
    expect(deviceScreen('approved')).toBe('login');
    expect(deviceScreen('pending')).toBe('waiting');
    expect(deviceScreen('denied')).toBe('denied');
    expect(deviceScreen('revoked')).toBe('revoked');
  });

  it('lets a new or expired device ask again', () => {
    expect(deviceScreen('none')).toBe('request');
    expect(deviceScreen('expired')).toBe('request');
  });
});

describe('browser labels', () => {
  it('names common browsers and systems', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'))
      .toBe('Edge on Windows');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('Safari on iOS');
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'))
      .toBe('Chrome on Android');
  });

  it('handles a missing User-Agent', () => {
    expect(describeUserAgent(null)).toBe('Unknown browser');
  });
});
