import { describe, expect, it } from 'vitest';

import { date } from '../date.js';

describe('date', () => {
  const moment = new Date(2026, 10, 4, 9, 30);

  it('formats a date and a date with time', () => {
    expect(date.format(moment)).toBe('2026-11-04');
    expect(date.formatDateTime(moment)).toBe('2026-11-04 09:30');
  });

  it('formats an invalid value as an empty string', () => {
    expect(date.format('not a date')).toBe('');
    expect(date.formatDateTime('not a date')).toBe('');
    expect(date.fromNow('not a date')).toBe('');
  });

  it('describes a past moment relative to now', () => {
    expect(date.fromNow(new Date(Date.now() - 3 * 86_400_000))).toBe(
      '3 days ago',
    );
  });

  it('parses a valid value and returns null for an invalid one without throwing', () => {
    expect(date.parse('2026-11-04T09:30:00Z')?.toISOString()).toBe(
      '2026-11-04T09:30:00.000Z',
    );
    expect(date.parse('not a date')).toBeNull();
    expect(date.parse(undefined)).toBeNull();
    expect(date.parse(null)).toBeNull();
  });
});
