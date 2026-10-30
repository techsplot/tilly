export type SmallTalk = "greeting" | "thanks" | "farewell";

const PHRASES: Record<SmallTalk, string[]> = {
  greeting: [
    "hi",
    "hello",
    "hey",
    "hiya",
    "good morning",
    "good afternoon",
    "good evening",
    "morning",
    "good day",
    "how are you",
    "how are you doing",
    "how far",
    "whatsup",
    "whats up",
    "what's up",
    "wassup",
    "sup",
    "e kaaro",
    "e kaasan",
    "e kaale",
    "sannu",
  ],
  thanks: [
    "thanks",
    "thank you",
    "thank you very much",
    "thanks a lot",
    "ok thanks",
    "okay thanks",
    "ok thank you",
    "okay thank you",
    "thank you so much",
    "e se",
    "na gode",
  ],
  farewell: ["bye", "goodbye", "good night", "see you", "see you later"],
};

// Words that may surround a greeting without changing it ("hello there",
// "hi Tilly").
const ADDRESS = new Set(["there", "tilly", "farm", "o", "oh"]);

function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z' ]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !ADDRESS.has(word))
    .join(" ");
}

/**
 * Recognises a message that is only a greeting, thanks, or goodbye, so the
 * agent can answer it without a model call. Anything with more in it ("hi, I
 * weeded the north field") is not small talk and goes to the model.
 */
export function classifySmallTalk(message: string): SmallTalk | null {
  const text = normalize(message);
  if (!text) return null;
  for (const [kind, phrases] of Object.entries(PHRASES) as Array<
    [SmallTalk, string[]]
  >) {
    if (phrases.includes(text)) return kind;
    // Two phrases of the same kind together: "hello, how are you?"
    const pair = phrases.some(
      (first) =>
        text.startsWith(`${first} `) &&
        phrases.includes(text.slice(first.length + 1)),
    );
    if (pair) return kind;
  }
  return null;
}

// Replies that decline to answer Tilly's question. "yes", "no" and "ok" are
// left out: they can answer a yes/no question such as "Was that today?".
const DECLINES = [
  "i don't know",
  "i dont know",
  "don't know",
  "dont know",
  "idk",
  "not sure",
  "i'm not sure",
  "im not sure",
  "no idea",
  "i forgot",
  "forgot",
  "i can't remember",
  "i cant remember",
  "can't remember",
  "cant remember",
  "skip",
  "skip it",
  "later",
  "not now",
  "never mind",
  "nevermind",
  "nothing",
  "none",
];

// Words that are never a crop or a field name, whatever the model says.
const FILLERS = new Set([
  ...DECLINES,
  "yes",
  "yeah",
  "yep",
  "no",
  "nope",
  "ok",
  "okay",
  "alright",
  "fine",
  "sure",
  "unknown",
  "n a",
]);

/**
 * True when a reply to Tilly's question does not answer it: small talk
 * ("thank you") or a decline ("I don't know", "skip"). The pending note is
 * then saved with its gap instead of reading the reply as a value; live
 * testing saved "thank you" as a weeding note's crop.
 */
export function isNonAnswer(reply: string): boolean {
  const text = normalize(reply);
  if (!text) return true;
  return classifySmallTalk(reply) !== null || DECLINES.includes(text);
}

/** True when a crop or field value is only filler, never a real name. */
export function isFillerValue(value: string): boolean {
  const text = normalize(value);
  return !text || FILLERS.has(text) || classifySmallTalk(value) !== null;
}
