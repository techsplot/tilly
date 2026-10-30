import type { FeedItem } from "@/app/hooks/useFarmAgent";
import { spokenText } from "@/app/lib/spoken-reply";
import {
  MAX_CONVERSATION_TURNS,
  MAX_TURN_CHARACTERS,
  type ConversationTurn,
} from "@/src/domain/conversation";

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_TURN_CHARACTERS
    ? trimmed
    : `${trimmed.slice(0, MAX_TURN_CHARACTERS - 1).trimEnd()}…`;
}

/**
 * The last few turns of the chat, as Tilly's model sees them: what the
 * farmer said, and what Tilly said back in plain words (the same words
 * talk back speaks). Tilly's actions in a row are one turn. Failed sends and
 * undone records are left out, since neither happened.
 */
export function recentConversation(feed: FeedItem[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const item of feed) {
    if (item.kind === "farmer") {
      turns.push({ from: "farmer", text: item.text });
      continue;
    }
    if (item.kind !== "action" || item.undone) continue;
    const text = spokenText(item.action);
    if (!text) continue;
    const last = turns.at(-1);
    if (last?.from === "tilly") last.text = `${last.text} ${text}`;
    else turns.push({ from: "tilly", text });
  }
  return turns
    .slice(-MAX_CONVERSATION_TURNS)
    .map((turn) => ({ ...turn, text: clip(turn.text) }))
    .filter((turn) => turn.text !== "");
}
