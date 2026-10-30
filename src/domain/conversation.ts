import { z } from "zod";
import { normalizeMemoryFieldName, type FarmMemory } from "./farm-memory";

// The last few turns of the chat, sent with each message so Tilly can follow
// "do the same for the cassava" or "and there too". Small on purpose: it is
// context for reading the new message, not a record of anything.
export const MAX_CONVERSATION_TURNS = 6;
export const MAX_TURN_CHARACTERS = 300;

export const conversationTurnSchema = z.object({
  from: z.enum(["farmer", "tilly"]),
  text: z.string().trim().min(1).max(MAX_TURN_CHARACTERS),
});

export const conversationSchema = z
  .array(conversationTurnSchema)
  .max(MAX_CONVERSATION_TURNS);

export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function mentions(text: string, value: string): boolean {
  const needle = words(value).trim();
  return needle !== "" && words(text).includes(` ${needle} `);
}

function isKnown(
  kind: "crop" | "field",
  value: string,
  memory: FarmMemory,
): boolean {
  const normalized = normalizeMemoryFieldName(value);
  if (kind === "field") {
    return memory.fields.some(
      (field) => normalizeMemoryFieldName(field.name) === normalized,
    );
  }
  return memory.recentEvents.some(
    (event) =>
      event.crop !== null &&
      normalizeMemoryFieldName(event.crop) === normalized,
  );
}

/**
 * Keeps a crop or field the model took from earlier in the conversation
 * only when the farmer said it, or it already exists on the farm. Tilly's
 * own words can point at a real field ("Recorded: weeding, North Field")
 * but can never introduce a new name. A value in the farmer's current
 * words is not this check's concern and is always kept.
 */
export function keepConversationValue(
  kind: "crop" | "field",
  value: string | null,
  farmerWords: string,
  conversation: ConversationTurn[],
  memory: FarmMemory,
): string | null {
  if (!value || conversation.length === 0) return value;
  if (mentions(farmerWords, value)) return value;
  if (
    conversation.some(
      (turn) => turn.from === "farmer" && mentions(turn.text, value),
    )
  ) {
    return value;
  }
  const onlyTillySaidIt = conversation.some(
    (turn) => turn.from === "tilly" && mentions(turn.text, value),
  );
  if (onlyTillySaidIt && !isKnown(kind, value, memory)) return null;
  return value;
}
