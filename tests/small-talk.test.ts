import { describe, expect, it } from "vitest";
import {
  classifySmallTalk,
  isFillerValue,
  isNonAnswer,
} from "../src/domain/small-talk";

describe("classifySmallTalk", () => {
  it.each([
    ["hello", "greeting"],
    ["Hi!", "greeting"],
    ["Good morning Tilly", "greeting"],
    ["hi Tilly", "greeting"],
    ["Hey farm", "greeting"],
    ["thanks Tilly", "thanks"],
    ["hello there", "greeting"],
    ["Hello, how are you?", "greeting"],
    ["whatsup", "greeting"],
    ["What's up?", "greeting"],
    ["E kaaro", "greeting"],
    ["Thank you!", "thanks"],
    ["ok thanks", "thanks"],
    ["Na gode", "thanks"],
    ["bye", "farewell"],
    ["Good night", "farewell"],
  ])("recognises %j as %s", (message, kind) => {
    expect(classifySmallTalk(message)).toBe(kind);
  });

  it.each([
    "hi, I weeded the north field",
    "hello what did I plant last week",
    "thanks, change that to the back field",
    "I planted maize",
    "",
    "!!!",
  ])("leaves %j for the model", (message) => {
    expect(classifySmallTalk(message)).toBeNull();
  });
});

describe("isNonAnswer", () => {
  it.each([
    "thank you",
    "Thanks Tilly!",
    "I don't know",
    "I dont know.",
    "not sure",
    "skip",
    "never mind",
    "",
  ])("%j does not answer the question", (reply) => {
    expect(isNonAnswer(reply)).toBe(true);
  });

  it.each(["maize", "the north field", "yes", "no", "ok", "yesterday"])(
    "%j may answer it",
    (reply) => {
      expect(isNonAnswer(reply)).toBe(false);
    },
  );
});

describe("isFillerValue", () => {
  it.each(["thank you", "yes", "OK", "no idea", "n/a", "unknown"])(
    "%j is never a crop or field",
    (value) => {
      expect(isFillerValue(value)).toBe(true);
    },
  );

  it.each(["maize", "North Field", "cassava", "Back Garden"])(
    "%j is a real name",
    (value) => {
      expect(isFillerValue(value)).toBe(false);
    },
  );
});
