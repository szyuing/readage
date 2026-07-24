/**
 * Time-zone aware calendar-date helpers for Memory V2.
 *
 * These helpers intentionally avoid reparsing localized strings as Date objects.
 * A Date is always an instant; the user's YYYY-MM-DD is derived directly from
 * Intl parts, and a local day boundary is located as an instant in UTC.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalDate(localDate: string): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(localDate);
  if (!match) {
    throw new RangeError(`Invalid local date: ${localDate}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid local date: ${localDate}`);
  }

  return { year, month, day };
}

function formatCalendarDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addCalendarDays(localDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(localDate);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatCalendarDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  );
}

/** Return the host/browser time zone, falling back to UTC. */
export function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Format an instant as YYYY-MM-DD in the supplied IANA time zone. */
export function getLocalDateInTimeZone(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('Invalid instant');
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');

  if (!year || !month || !day) {
    throw new RangeError(`Unable to format date in time zone: ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

/**
 * Convert the end of a user's local calendar day to its exact UTC instant.
 *
 * The first instant belonging to the next local date is found with a binary
 * search, then one millisecond is subtracted. This handles UTC offsets and
 * 23/25-hour daylight-saving days without assuming a fixed offset.
 */
export function getUtcInstantForLocalDayEnd(localDate: string, timeZone: string): Date {
  const nextLocalDate = addCalendarDays(localDate, 1);
  const { year, month, day } = parseLocalDate(nextLocalDate);
  const approximateUtcMidnight = Date.UTC(year, month - 1, day);

  let low = approximateUtcMidnight - 2 * DAY_MS;
  let high = approximateUtcMidnight + 2 * DAY_MS;

  if (getLocalDateInTimeZone(new Date(low), timeZone) >= nextLocalDate) {
    throw new RangeError(`Unable to locate start of ${nextLocalDate} in ${timeZone}`);
  }
  if (getLocalDateInTimeZone(new Date(high), timeZone) < nextLocalDate) {
    throw new RangeError(`Unable to locate start of ${nextLocalDate} in ${timeZone}`);
  }

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (getLocalDateInTimeZone(new Date(middle), timeZone) < nextLocalDate) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return new Date(low - 1);
}
