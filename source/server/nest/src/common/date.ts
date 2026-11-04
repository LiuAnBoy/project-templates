/**
 * The only file that imports dayjs. Everything else formats, parses and
 * compares moments through `date`, so the library can change in one place.
 */
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';

dayjs.extend(relativeTime);

/** Anything a moment can be read from: a Date, an ISO string or a millisecond timestamp. */
export type DateInput = Date | string | number;

/**
 * Reads a value as a dayjs object, treating null and undefined as invalid
 * (dayjs itself would read undefined as "now").
 *
 * @param value - The value to read.
 * @returns The dayjs object, valid or not.
 */
function read(value: DateInput | null | undefined): dayjs.Dayjs {
  return value === null || value === undefined ? dayjs(NaN) : dayjs(value);
}

/** Date helpers for the whole server; see each member. */
export const date = {
  /**
   * Formats a value as a date, for example `2026-11-04`.
   *
   * @param value - The moment to format.
   * @returns The date, or an empty string when the value is invalid.
   */
  format(value: DateInput): string {
    const parsed = read(value);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '';
  },

  /**
   * Formats a value as a date and time, for example `2026-11-04 09:30`.
   *
   * @param value - The moment to format.
   * @returns The date and time, or an empty string when the value is invalid.
   */
  formatDateTime(value: DateInput): string {
    const parsed = read(value);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : '';
  },

  /**
   * Describes how long ago a moment was, for example `3 days ago`.
   *
   * @param value - The moment to describe.
   * @returns The description, or an empty string when the value is invalid.
   */
  fromNow(value: DateInput): string {
    const parsed = read(value);
    return parsed.isValid() ? parsed.fromNow() : '';
  },

  /**
   * Reads a value as a moment without throwing.
   *
   * @param value - A Date, an ISO string or a millisecond timestamp.
   * @returns The moment as a Date, or null when the value is invalid.
   */
  parse(value: DateInput | null | undefined): Date | null {
    const parsed = read(value);
    return parsed.isValid() ? parsed.toDate() : null;
  },
};
