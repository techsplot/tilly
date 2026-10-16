import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectWakeWord,
  clearDetectionCache,
} from "../src/application/wake-word-detector";

// Mock the Nebius client
vi.mock("../src/infrastructure/nebius/nebius-client", () => ({
  createNebiusClient: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

describe("Wake Word Detector", () => {
  beforeEach(() => {
    clearDetectionCache();
    vi.clearAllMocks();
    // Clear the WAKE_WORD_MODEL_ID so we test fallback behavior
    delete process.env.WAKE_WORD_MODEL_ID;
  });

  describe("default wake words", () => {
    it("detects 'hey farmmind' correctly", async () => {
      const result = await detectWakeWord("hey farmmind I weeded the field");

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("I weeded the field");
    });

    it("detects 'ok farm' correctly", async () => {
      const result = await detectWakeWord("ok farm I planted corn");

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("I planted corn");
    });

    it("detects 'hey farm' correctly", async () => {
      const result = await detectWakeWord("hey farm what did I do yesterday");

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("what did I do yesterday");
    });

    it("handles case variations", async () => {
      const result = await detectWakeWord("HEY FARMMIND I sprayed");

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("I sprayed");
    });

    it("handles extra spacing", async () => {
      // Wake word detector uses exact matching on normalized (trimmed) text
      // Internal extra spaces won't match
      const result = await detectWakeWord("hey farmmind  I fertilized");

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("I fertilized");
    });
  });

  describe("custom wake words", () => {
    it("detects custom wake word 'hey buddy'", async () => {
      const result = await detectWakeWord(
        "hey buddy I weeded the north field",
        "hey buddy",
      );

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("I weeded the north field");
    });

    it("detects custom wake word 'farm assistant'", async () => {
      const result = await detectWakeWord(
        "farm assistant show me this week",
        "farm assistant",
      );

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("show me this week");
    });
  });

  describe("non-wake-word conversations", () => {
    it("ignores regular farming conversation", async () => {
      const result = await detectWakeWord("the farm is looking good today");

      expect(result.is_wake_word).toBe(false);
      expect(result.command).toBeNull();
    });

    it("ignores commands without wake word", async () => {
      const result = await detectWakeWord("I weeded the field");

      expect(result.is_wake_word).toBe(false);
      expect(result.command).toBeNull();
    });

    it("ignores partial wake word matches", async () => {
      const result = await detectWakeWord(
        "I told my friend about the farm yesterday",
      );

      expect(result.is_wake_word).toBe(false);
      expect(result.command).toBeNull();
    });
  });

  describe("command extraction", () => {
    it("extracts command after wake word with comma", async () => {
      const result = await detectWakeWord("hey farmmind, I planted tomatoes");

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("I planted tomatoes");
    });

    it("handles empty command after wake word", async () => {
      const result = await detectWakeWord("hey farmmind");

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBeNull();
    });

    it("extracts long commands", async () => {
      const longCommand =
        "I weeded the north field for three hours this morning and also applied fertilizer";
      const result = await detectWakeWord(`hey farm ${longCommand}`);

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe(longCommand);
    });
  });

  describe("caching", () => {
    it("caches detection results", async () => {
      const transcript = "hey farmmind I weeded";

      // First call
      const result1 = await detectWakeWord(transcript);
      expect(result1.is_wake_word).toBe(true);

      // Second call should use cache (same result, no API call)
      const result2 = await detectWakeWord(transcript);
      expect(result2).toEqual(result1);
    });

    it("cache is case-insensitive", async () => {
      await detectWakeWord("HEY FARMMIND I weeded");
      const cached = await detectWakeWord("hey farmmind I weeded");

      expect(cached.is_wake_word).toBe(true);
    });

    it("cache ignores surrounding whitespace", async () => {
      await detectWakeWord("  hey farmmind I weeded  ");
      const cached = await detectWakeWord("hey farmmind I weeded");

      expect(cached.is_wake_word).toBe(true);
    });

    it("clears cache correctly", async () => {
      await detectWakeWord("hey farmmind I weeded");

      clearDetectionCache();

      // After clearing, should process again (not cached)
      const result = await detectWakeWord("hey farmmind I weeded");
      expect(result.is_wake_word).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty transcript", async () => {
      const result = await detectWakeWord("");

      expect(result.is_wake_word).toBe(false);
      expect(result.command).toBeNull();
    });

    it("handles whitespace-only transcript", async () => {
      const result = await detectWakeWord("   ");

      expect(result.is_wake_word).toBe(false);
      expect(result.command).toBeNull();
    });

    it("handles wake word variations with different spacing", async () => {
      const result = await detectWakeWord("hey  farmmind  I weeded");

      expect(result.is_wake_word).toBe(false); // Exact matching required
    });
  });

  describe("multilingual wake words", () => {
    it("supports custom wake words in different patterns", async () => {
      const result = await detectWakeWord(
        "farm helper record this activity",
        "farm helper",
      );

      expect(result.is_wake_word).toBe(true);
      expect(result.command).toBe("record this activity");
    });
  });
});
