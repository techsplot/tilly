const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function parseDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The date a farm note means by a weekday name ("on Monday", "last
 * Tuesday"), counted back from `currentDate`. Records describe what already
 * happened, so a bare weekday is the most recent one: "Monday" said on a
 * Saturday is five days ago, and said on a Monday is today, unless it is
 * "last Monday". Returns null when the message names no weekday, more than
 * one, or a future one ("next Monday").
 */
export function resolveWeekdayDate(
  message: string,
  currentDate: string,
): string | null {
  const text = message.toLowerCase();
  const named = WEEKDAYS.filter((day) => new RegExp(`\\b${day}\\b`).test(text));
  if (named.length !== 1) return null;
  const weekday = named[0]!;
  if (new RegExp(`\\b(next|coming|this coming)\\s+${weekday}\\b`).test(text))
    return null;

  const today = parseDate(currentDate);
  let daysBack = (today.getUTCDay() - WEEKDAYS.indexOf(weekday) + 7) % 7;
  if (daysBack === 0 && new RegExp(`\\blast\\s+${weekday}\\b`).test(text))
    daysBack = 7;
  today.setUTCDate(today.getUTCDate() - daysBack);
  return formatDate(today);
}
