/**
 * Quiet hours helper.
 *
 * Quiet hours are defined as 10:00 PM – 7:00 AM UTC (hours 22–23 and 0–6).
 * No outbound SMS should be sent during this window.
 */

/**
 * Returns true if the given time (default: now) falls within quiet hours.
 *
 * Quiet hours: UTC 22:00–06:59 (inclusive).
 * Active hours: UTC 07:00–21:59 (inclusive).
 */
export function isInQuietHours(now?: Date): boolean {
  const date = now ?? new Date();
  const hour = date.getUTCHours();
  // Quiet: 0–6 and 22–23
  return hour <= 6 || hour >= 22;
}

/**
 * Returns the next 7:00 AM UTC delivery window from the given time.
 *
 * - If currently in quiet hours (22:00–06:59): returns 07:00 UTC today or tomorrow
 * - If already past 07:00 UTC: returns the current time (deliver now)
 */
export function nextDeliveryWindow(from?: Date): Date {
  const date = from ?? new Date();
  const hour = date.getUTCHours();

  // If it's already 07:00–21:59 UTC, delivery can happen now
  if (hour >= 7 && hour < 22) {
    return new Date(date);
  }

  // Otherwise we're in quiet hours — find the next 07:00 UTC
  const next = new Date(date);

  if (hour < 7) {
    // Same calendar day, just set to 07:00
    next.setUTCHours(7, 0, 0, 0);
  } else {
    // hour >= 22 — advance to next day 07:00
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(7, 0, 0, 0);
  }

  return next;
}
