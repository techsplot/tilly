import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("../src/infrastructure/nebius/nebius-client", () => ({
  createNebiusClient: vi.fn(() => ({
    chat: { completions: { create: mockCreate } },
  })),
  getNebiusModel: vi.fn(() => "test-model"),
}));

import { extractFarmEvent } from "../src/application/extract-farm-event";

const memory = {
  fields: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Back Field" }],
  recentEvents: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      activity: "planting",
      crop: "maize",
      field: "Back Field",
      eventDate: "2026-10-10",
    },
  ],
};

function modelResponse(event: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            events: [event],
            clarificationRequired: false,
            clarificationQuestion: null,
          }),
        },
      },
    ],
  };
}

describe("farm event extraction memory", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("omits empty memory from the model request", async () => {
    mockCreate.mockResolvedValueOnce(
      modelResponse({
        activity: "weeding",
        crop: null,
        field: null,
        eventDate: "2026-10-12",
        quantity: null,
        unit: null,
      }),
    );
    await extractFarmEvent("I weeded a field", "2026-10-12");
    const request = mockCreate.mock.calls[0]![0];
    expect(JSON.parse(request.messages[1].content)).not.toHaveProperty(
      "farmMemory",
    );
  });

  it("sends non-empty memory and preserves a verified resolution", async () => {
    mockCreate.mockResolvedValueOnce(
      modelResponse({
        activity: "weeding",
        crop: null,
        field: "back field",
        eventDate: "2026-10-12",
        quantity: null,
        unit: null,
        fieldSource: "memory",
        memoryEventIds: [memory.recentEvents[0]!.id],
      }),
    );
    const result = await extractFarmEvent(
      "I weeded that field",
      "2026-10-12",
      undefined,
      memory,
    );
    const request = mockCreate.mock.calls[0]![0];
    expect(JSON.parse(request.messages[1].content).farmMemory).toEqual(memory);
    expect(result.events[0]?.field).toBe("Back Field");
    expect(result.events[0]?.resolvedFromMemory).toHaveLength(1);
  });

  it("removes a model-invented memory field and asks for clarification", async () => {
    mockCreate.mockResolvedValueOnce(
      modelResponse({
        activity: "weeding",
        crop: null,
        field: "Invented Field",
        eventDate: "2026-10-12",
        quantity: null,
        unit: null,
        fieldSource: "memory",
        memoryEventIds: [memory.recentEvents[0]!.id],
      }),
    );
    const result = await extractFarmEvent(
      "I weeded that field",
      "2026-10-12",
      undefined,
      memory,
    );
    expect(result.events[0]?.field).toBeNull();
    expect(result.events[0]?.status).toBe("incomplete");
    expect(result.events[0]?.unresolvedReferences).toContain("field");
    expect(result.clarificationRequired).toBe(true);
    expect(result.clarificationQuestion).toContain("Back Field");
  });
});
