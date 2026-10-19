import { APIConnectionTimeoutError } from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("../src/infrastructure/nebius/nebius-client", () => ({
  createNebiusClient: vi.fn(() => ({
    chat: { completions: { create: mockCreate } },
  })),
  getNebiusModel: vi.fn(() => "test-model"),
}));

import { extractFarmEvent } from "../src/application/extract-farm-event";
import { looksLikeQuestion } from "../src/domain/question-shape";

function reply(body: Record<string, unknown> | string) {
  const full =
    typeof body === "string"
      ? body
      : JSON.stringify({
          clarificationRequired: false,
          clarificationQuestion: null,
          followUpQuestion: null,
          ...body,
        });
  return {
    choices: [
      {
        message: {
          content: full,
        },
      },
    ],
  };
}

const spraying = {
  intent: "record",
  events: [
    {
      activity: "spraying",
      crop: null,
      field: null,
      eventDate: null,
      quantity: null,
      unit: null,
    },
  ],
};
const asQuestion = {
  intent: "question",
  events: [],
  filter: { activity: "spraying" },
};

const thinkingOff = { chat_template_kwargs: { enable_thinking: false } };
const thinkingFlags = () =>
  mockCreate.mock.calls.map((call) => "chat_template_kwargs" in call[0]);

describe("fast and careful extraction", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("answers most messages with one fast call, thinking off", async () => {
    mockCreate.mockResolvedValueOnce(reply(spraying));
    const result = await extractFarmEvent("I sprayed", "2026-10-17");
    expect(result.intent).toBe("record");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]![0]).toMatchObject(thinkingOff);
  });

  it("re-reads a 'question' that is not worded as one, with thinking on", async () => {
    mockCreate
      .mockResolvedValueOnce(reply(asQuestion))
      .mockResolvedValueOnce(reply(spraying));
    const result = await extractFarmEvent("I sprayed", "2026-10-17");
    expect(result.intent).toBe("record");
    expect(thinkingFlags()).toEqual([true, false]);
  });

  it("trusts a 'question' that is worded as one", async () => {
    mockCreate.mockResolvedValueOnce(reply(asQuestion));
    const result = await extractFarmEvent(
      "when did I last spray?",
      "2026-10-17",
    );
    expect(result.intent).toBe("question");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("re-reads 'other', which would drop the message", async () => {
    mockCreate
      .mockResolvedValueOnce(reply({ intent: "other", events: [] }))
      .mockResolvedValueOnce(reply(spraying));
    const result = await extractFarmEvent("sprayed today", "2026-10-17");
    expect(result.intent).toBe("record");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("does not re-read answers to a pending question", async () => {
    mockCreate.mockResolvedValueOnce(reply({ intent: "other", events: [] }));
    await extractFarmEvent("I sprayed", "2026-10-17", [
      { question: "Which field?", answer: "I don't know" },
    ]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("asks again with thinking on when the fast reply is unusable", async () => {
    mockCreate
      .mockResolvedValueOnce(reply("not json"))
      .mockResolvedValueOnce(reply(spraying));
    const result = await extractFarmEvent("I sprayed", "2026-10-17");
    expect(result.intent).toBe("record");
    expect(thinkingFlags()).toEqual([true, false]);
  });

  it("does not retry a timeout, which would only take longer", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIConnectionTimeoutError({ message: "timed out" }),
    );
    await expect(extractFarmEvent("I sprayed", "2026-10-17")).rejects.toThrow(
      APIConnectionTimeoutError,
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("reads an unknown source label as not stated instead of failing", async () => {
    mockCreate.mockResolvedValueOnce(
      reply({
        intent: "record",
        events: [{ ...spraying.events[0], fieldSource: "null" }],
      }),
    );
    const result = await extractFarmEvent("I sprayed", "2026-10-17");
    expect(result.intent).toBe("record");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe("looksLikeQuestion", () => {
  it.each([
    "when did I last spray?",
    "What did I do this week",
    "show me this month",
    "give me a report for October",
    "did I weed the north field",
    "anything planted yesterday?",
  ])("treats %j as a question", (message) => {
    expect(looksLikeQuestion(message)).toBe(true);
  });

  it.each(["I sprayed", "planted maize yesterday", "remind me to weed"])(
    "does not treat %j as a question",
    (message) => {
      expect(looksLikeQuestion(message)).toBe(false);
    },
  );
});
