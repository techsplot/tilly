import { describe, expect, it } from "vitest";
import { classifySmallTalk } from "../src/domain/small-talk";

describe("classifySmallTalk", () => {
  it.each([
    ["hello", "greeting"],
    ["Hi!", "greeting"],
    ["Good morning FarmMind", "greeting"],
    ["hello there", "greeting"],
    ["Hello, how are you?", "greeting"],
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
