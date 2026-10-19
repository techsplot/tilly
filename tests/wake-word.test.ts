import { describe, expect, it } from "vitest";
import { matchWakeWord, wakeWordSchema } from "../src/domain/wake-word";

describe("matchWakeWord", () => {
  it("detects the default wake word and extracts the command", () => {
    expect(
      matchWakeWord("hey farmmind I weeded the field", "hey farmmind"),
    ).toEqual({ matched: true, command: "I weeded the field" });
  });

  it("ignores case and punctuation from speech-to-text", () => {
    expect(
      matchWakeWord("Hey, FarmMind! I sprayed the back field.", "hey farmmind"),
    ).toEqual({ matched: true, command: "I sprayed the back field." });
  });

  it("treats spacing inside the wake word as the same phrase", () => {
    expect(
      matchWakeWord("hey farm mind I planted maize", "hey farmmind"),
    ).toEqual({ matched: true, command: "I planted maize" });
    expect(
      matchWakeWord("ok farmmind I planted maize", "ok farm mind"),
    ).toEqual({ matched: true, command: "I planted maize" });
  });

  it("accepts okay for ok", () => {
    expect(
      matchWakeWord("okay farm I watered the seedlings", "ok farm"),
    ).toEqual({ matched: true, command: "I watered the seedlings" });
  });

  it("skips leading filler words", () => {
    expect(matchWakeWord("um hey farm I harvested beans", "hey farm")).toEqual({
      matched: true,
      command: "I harvested beans",
    });
  });

  it("works with a custom wake word", () => {
    expect(
      matchWakeWord("Hey Buddy, what did I plant yesterday", "hey buddy"),
    ).toEqual({ matched: true, command: "what did I plant yesterday" });
  });

  it("only matches the farm's own wake word", () => {
    expect(matchWakeWord("hey farmmind I weeded", "hey buddy").matched).toBe(
      false,
    );
    expect(matchWakeWord("hey buddy I weeded", "hey farmmind").matched).toBe(
      false,
    );
  });

  it("ignores speech without the wake word", () => {
    expect(matchWakeWord("the farm is looking good today", "hey farm")).toEqual(
      { matched: false, command: null },
    );
  });

  it("ignores the wake word in the middle of a sentence", () => {
    expect(
      matchWakeWord("I told him hey farmmind is useful", "hey farmmind")
        .matched,
    ).toBe(false);
  });

  it("does not match a longer word that starts like the wake word", () => {
    expect(matchWakeWord("hey farmers I weeded", "hey farm").matched).toBe(
      false,
    );
  });

  it("returns no command when only the wake word was said", () => {
    expect(matchWakeWord("Hey FarmMind.", "hey farmmind")).toEqual({
      matched: true,
      command: null,
    });
  });

  it("does not match an empty transcript or empty wake word", () => {
    expect(matchWakeWord("", "hey farm").matched).toBe(false);
    expect(matchWakeWord("hey farm I weeded", "").matched).toBe(false);
  });
});

describe("wakeWordSchema", () => {
  it("normalises case and spacing", () => {
    expect(wakeWordSchema.parse("  Hey   Buddy ")).toBe("hey buddy");
  });

  it.each([
    ["empty", ""],
    ["one character", "a"],
    ["over 50 characters", "a".repeat(51)],
    ["digits", "hey farm 2"],
    ["special characters", "hey <farm>"],
  ])("rejects %s", (_label, value) => {
    expect(wakeWordSchema.safeParse(value).success).toBe(false);
  });
});
