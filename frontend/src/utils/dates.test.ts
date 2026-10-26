import { describe, expect, it } from 'vitest';
import { ageFromBirthDate, formatDisplayTime, formatLogTime, getLocalDateString, localYmd, parseLogDate, timeBetween } from './dates';

describe('timeBetween', () => {
  it('describes short spans in days and weeks', () => {
    expect(timeBetween('2026-01-01', '2026-01-01')).toBe('Same day');
    expect(timeBetween('2026-01-01', '2026-01-06')).toBe('5 days');
    expect(timeBetween('2026-01-01', '2026-01-18')).toBe('2 weeks, 3 days');
  });

  it('describes longer spans in years, months, and weeks', () => {
    expect(timeBetween('2026-01-01', '2026-04-09')).toBe('3 months, 1 week');
    expect(timeBetween('2025-01-01', '2026-03-01')).toBe('1 year, 2 months');
  });

  it('ignores argument order', () => {
    expect(timeBetween('2026-01-18', '2026-01-01')).toBe(timeBetween('2026-01-01', '2026-01-18'));
  });
});

describe('ageFromBirthDate', () => {
  it('counts whole years, turning over on the birthday', () => {
    expect(ageFromBirthDate('2000-06-15', new Date(2026, 5, 14))).toBe(25);
    expect(ageFromBirthDate('2000-06-15', new Date(2026, 5, 15))).toBe(26);
    expect(ageFromBirthDate('2000-06-15T00:00:00.000Z', new Date(2026, 5, 15))).toBe(26);
  });

  it('returns null for missing, invalid, or future dates', () => {
    expect(ageFromBirthDate('')).toBeNull();
    expect(ageFromBirthDate('not a date')).toBeNull();
    expect(ageFromBirthDate('2030-01-01', new Date(2026, 0, 1))).toBeNull();
  });
});

describe('date-only values', () => {
  it('are read as local dates, not UTC', () => {
    expect(parseLogDate('2026-03-04')).toEqual(new Date(2026, 2, 4));
    expect(parseLogDate(null)).toBeNull();
  });

  it('have no time of day', () => {
    expect(formatLogTime('2026-03-04')).toBe('');
    expect(formatLogTime(null)).toBe('');
  });

  it('format as YYYY-MM-DD in local time', () => {
    expect(getLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localYmd(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(localYmd('garbage')).toBe('');
  });
});

describe('formatDisplayTime', () => {
  it('converts 24-hour times to 12-hour', () => {
    expect(formatDisplayTime('14:30:00')).toBe('2:30 PM');
    expect(formatDisplayTime('00:05')).toBe('12:05 AM');
    expect(formatDisplayTime('12:00')).toBe('12:00 PM');
  });

  it('leaves times that already have AM/PM alone', () => {
    expect(formatDisplayTime('9:00 am')).toBe('9:00 am');
    expect(formatDisplayTime(undefined)).toBe('');
  });
});
