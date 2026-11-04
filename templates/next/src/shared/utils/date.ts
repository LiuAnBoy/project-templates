import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-tw';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
dayjs.locale('zh-tw');

/** Anything dayjs accepts: a Date, an ISO string or a millisecond timestamp. */
export type DateInput = Date | string | number;

/**
 * The one place dayjs is used. Formatting an invalid value yields an empty
 * string, never "Invalid Date".
 */
export const date = {
  /** Parse a value; returns null when it is not a valid date. Never throws. */
  parse(value: DateInput): Dayjs | null {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
  },
  /** Format as `YYYY-MM-DD`, or an empty string when invalid. */
  format(value: DateInput): string {
    return this.parse(value)?.format('YYYY-MM-DD') ?? '';
  },
  /** Format as `YYYY-MM-DD HH:mm`, or an empty string when invalid. */
  formatDateTime(value: DateInput): string {
    return this.parse(value)?.format('YYYY-MM-DD HH:mm') ?? '';
  },
  /** Relative text in Traditional Chinese, such as `3 天前`; empty when invalid. */
  fromNow(value: DateInput, now: DateInput = new Date()): string {
    return this.parse(value)?.from(dayjs(now)) ?? '';
  },
};
