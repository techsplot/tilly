import { formatDate } from "@/app/lib/format";

export type GreetingRecord = {
  activity: string;
  crop: string | null;
  field: string | null;
  eventDate: string | null;
};

// Activities where the crop reads naturally after the verb ("planting
// maize"); for the rest ("inspection maize") it is left out.
const CROP_ACTIVITIES = new Set(["planting", "harvesting"]);

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function salutation(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Hello!";
  if (hour < 12) return "Good morning!";
  if (hour < 17) return "Good afternoon!";
  return "Good evening!";
}

function when(eventDate: string | null, now: Date): string {
  if (!eventDate) return "";
  if (eventDate === localDate(now)) return " today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (eventDate === localDate(yesterday)) return " yesterday";
  return ` on ${formatDate(eventDate)}`;
}

const ACTIVITY_PHRASES: Record<string, string> = {
  inspection: "an inspection",
  other: "a farm activity",
};

function describe(record: GreetingRecord, now: Date): string {
  const activity = ACTIVITY_PHRASES[record.activity] ?? record.activity;
  const crop =
    record.crop && CROP_ACTIVITIES.has(record.activity)
      ? ` ${record.crop}`
      : "";
  const field = record.field ? ` in ${record.field}` : "";
  return `${activity}${crop}${field}${when(record.eventDate, now)}`;
}

/**
 * FarmMind's opening message: a greeting for the farmer's time of day that
 * names the farm and, when there is one, the last thing recorded there.
 */
export function buildGreeting(
  farmName: string,
  lastRecord: GreetingRecord | null,
  now: Date = new Date(),
): string {
  // The default name reads badly in a sentence ("on My Farm").
  const farm = farmName === "My Farm" ? "your farm" : farmName;
  if (!lastRecord) {
    return `${salutation(now)} I'm FarmMind. Tell me what happened on ${farm} today, in your own words, and I'll keep the record.`;
  }
  return `${salutation(now)} The last thing you recorded on ${farm} was ${describe(lastRecord, now)}. What did you do today?`;
}
