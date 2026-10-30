import type { AgentAction, FeedItem } from "@/app/hooks/useFarmAgent";
import { undoableSummary } from "@/app/lib/action-summary";
import { formatDate } from "@/app/lib/format";

export type SpokenReply = { key: string; text: string };

const MAX_SPOKEN_REMINDERS = 3;

// Receipts are written for the eye ("spraying · today", "a → b"); this
// makes them sound like a sentence and drops emoji a voice would spell out.
export function speakable(text: string): string {
  return text
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s*→\s*/g, " to ")
    .replace(/[✓\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// What Tilly says for one action. Buttons, cited records and suggestions
// stay on screen only.
export function spokenText(action: AgentAction): string {
  switch (action.type) {
    case "recorded":
    case "corrected":
    case "deleted":
      return speakable(undoableSummary(action));
    case "reminders-list": {
      const count = action.reminders.length;
      if (count === 0) return "You have no upcoming reminders.";
      const listed = action.reminders
        .slice(0, MAX_SPOKEN_REMINDERS)
        .map((reminder) =>
          [
            formatDate(reminder.date),
            reminder.activity,
            reminder.field,
            reminder.crop,
          ]
            .filter(Boolean)
            .join(" "),
        );
      const more =
        count > MAX_SPOKEN_REMINDERS
          ? ` And ${count - MAX_SPOKEN_REMINDERS} more.`
          : "";
      return `You have ${count} upcoming reminder${count === 1 ? "" : "s"}: ${listed.join("; ")}.${more}`;
    }
    default:
      return speakable(action.text);
  }
}

/**
 * Tilly's reply to the farmer's latest message, once it has arrived: every
 * agent item after that message, joined into one thing to say. The key is
 * the newest item's id, so the same reply is never spoken twice.
 */
export function latestReply(feed: FeedItem[]): SpokenReply | null {
  let start = feed.length;
  while (start > 0 && feed[start - 1]!.kind !== "farmer") start -= 1;
  if (start === 0 || start === feed.length) return null;

  const parts = feed.slice(start).flatMap((item) => {
    if (item.kind === "failed") return [speakable(item.error)];
    if (item.kind === "action" && !item.undone)
      return [spokenText(item.action)];
    return [];
  });
  const text = parts.filter(Boolean).join(" ");
  if (!text) return null;
  return { key: feed.at(-1)!.id, text };
}
