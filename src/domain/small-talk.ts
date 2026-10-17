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
// "hi FarmMind").
const ADDRESS = new Set(["there", "farmmind", "farm", "mind", "o", "oh"]);

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
