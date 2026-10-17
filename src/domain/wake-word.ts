import { z } from "zod";

export const DEFAULT_WAKE_WORD = "hey farmmind";
export const PRESET_WAKE_WORDS = ["hey farmmind", "ok farm", "hey farm"];

// Letters and spaces only, so the phrase can be spoken and matched against
// speech-to-text output. Stored lowercase with single spaces.
export const wakeWordSchema = z
  .string()
  .trim()
  .min(2, "Wake word must be at least 2 characters")
  .max(50, "Wake word must be at most 50 characters")
  .regex(/^[a-zA-Z ]+$/, "Wake word can only contain letters and spaces")
  .transform((value) => value.toLowerCase().replace(/\s+/g, " "));

export type WakeWordMatch =
  { matched: false; command: null } | { matched: true; command: string | null };

// Words speech recognisers commonly put before a phrase.
const FILLERS = new Set(["um", "umm", "uh", "er", "erm", "ah", "oh", "so"]);
const SPOKEN_FORMS: Record<string, string> = { okay: "ok" };

function normalizeToken(token: string): string {
  const word = token.toLowerCase().replace(/[^a-z0-9']/g, "");
  return SPOKEN_FORMS[word] ?? word;
}

function wakeKey(wakeWord: string): string {
  return wakeWord.split(/\s+/).map(normalizeToken).join("");
}

/**
 * Decides whether a transcript starts with the farm's wake word and returns
 * what was said after it. Runs in the browser so speech without the wake
 * word never reaches FarmMind's server.
 *
 * Spacing is ignored when comparing ("farm mind" matches "farmmind"), so is
 * punctuation and case. A wake word said in the middle of a sentence does
 * not count.
 */
export function matchWakeWord(
  transcript: string,
  wakeWord: string,
): WakeWordMatch {
  const key = wakeKey(wakeWord);
  if (!key) return { matched: false, command: null };

  const tokens = transcript.trim().split(/\s+/).filter(Boolean);
  let start = 0;
  while (
    start < tokens.length &&
    (FILLERS.has(normalizeToken(tokens[start]!)) ||
      normalizeToken(tokens[start]!) === "")
  ) {
    start += 1;
  }

  let spoken = "";
  for (let index = start; index < tokens.length; index += 1) {
    spoken += normalizeToken(tokens[index]!);
    if (spoken === key) {
      const command = tokens
        .slice(index + 1)
        .join(" ")
        .replace(/^[\s,.!?;:-]+/, "")
        .trim();
      return { matched: true, command: command || null };
    }
    if (!key.startsWith(spoken)) break;
  }
  return { matched: false, command: null };
}
