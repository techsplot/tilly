// "2026-10-17" → "17 Oct". Dates are calendar days, so they are read as UTC
// to avoid shifting a day in timezones west of UTC.
export function formatDate(isoDate: string | null): string {
  if (!isoDate) return "no date";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const WAKE_WORD_LABELS: Record<string, string> = {
  "hey farmmind": "Hey FarmMind",
  "ok farm": "OK Farm",
  "hey farm": "Hey Farm",
};

// Wake words are stored lowercase; show them the way people write them.
export function displayWakeWord(wakeWord: string): string {
  return (
    WAKE_WORD_LABELS[wakeWord] ??
    wakeWord.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  );
}

// A feed timestamp in the farmer's own clock, e.g. "09:41".
export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
