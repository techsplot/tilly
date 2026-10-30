import type {
  SavedFarmEvent,
  UndoableAgentAction,
} from "@/app/hooks/useFarmAgent";
import { formatDate } from "@/app/lib/format";

// Receipt text shared by the chat bubbles and talk back, so Tilly says what
// the screen shows.

function formatFieldLabel(field: string): string {
  if (field === "eventDate") return "date";
  if (field === "eventTime") return "time";
  if (field === "timeOfDay") return "time of day";
  return field;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "nothing";
  return String(value);
}

function dateTimeLabel(event: SavedFarmEvent): string {
  const date = !event.eventDate
    ? "no date"
    : event.dateAssumed
      ? "today"
      : formatDate(event.eventDate);
  if (event.eventTime) return `${date} ${event.eventTime.slice(0, 5)}`;
  if (event.timeOfDay) return `${date}, ${event.timeOfDay}`;
  return date;
}

// Finding 11: records save with gaps rather than blocking on them, so the
// receipt names what was not mentioned instead of hiding missing details.
function gapNote(missingFields: string[]): string {
  if (missingFields.length === 0) return "";
  const labels = missingFields.map((field) =>
    field === "eventDate" ? "date" : field,
  );
  return ` (${labels.join(", ")} not given)`;
}

export function undoableSummary(action: UndoableAgentAction): string {
  if (action.type === "recorded") {
    if (action.possibleDuplicate) return "Looks like a repeat.";
    const segments: string[] = [action.event.activity];
    if (action.event.field) segments.push(action.event.field);
    segments.push(dateTimeLabel(action.event));
    return `Recorded: ${segments.join(" · ")}${gapNote(action.event.missingFields)}`;
  }
  if (action.type === "corrected") {
    const changes = action.changes
      .map(
        (change) =>
          `${formatFieldLabel(change.field)} ${formatValue(change.before)} → ${formatValue(change.after)}`,
      )
      .join(", ");
    return `Corrected: ${action.event.activity} · ${changes}`;
  }
  return `Deleted: ${action.event.activity} · ${action.event.field ?? "no field"} · ${formatDate(action.event.eventDate)}`;
}
