import { describe, expect, it } from 'vitest';

import { date } from '../date';

describe('date', () => {
  const moment = new Date(2026, 10, 4, 9, 30);

  it('formats a date and a date with time', () => {
    expect(date.format(moment)).toBe('2026-11-04');
    expect(date.formatDateTime(moment)).toBe('2026-11-04 09:30');
  });

  it('describes a past moment in Traditional Chinese', () => {
    expect(date.fromNow(moment, new Date(2026, 10, 7, 9, 30))).toBe('3 天前');
  });

  it('parses a valid value and returns null for an invalid one', () => {
    expect(date.parse(moment)?.year()).toBe(2026);
    expect(date.parse('not a date')).toBeNull();
  });

  it('never produces "Invalid Date"', () => {
    expect(date.format('not a date')).toBe('');
    expect(date.formatDateTime('not a date')).toBe('');
    expect(date.fromNow('not a date')).toBe('');
  });
});
