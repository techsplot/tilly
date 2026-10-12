import { describe, expect, it } from "vitest";
import {
  type FarmMemory,
  verifyMemoryReferences,
} from "../src/domain/farm-memory";

const firstEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  activity: "planting",
  crop: "maize",
  field: "Back Field",
  eventDate: "2026-10-10",
};

const memory: FarmMemory = {
  fields: [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Back Field" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "River Field" },
  ],
  recentEvents: [firstEvent],
};

describe("memory reference verification", () => {
  it("does not change events that do not use memory", () => {
    const result = verifyMemoryReferences(
      {
        field: "New Field",
        crop: "cassava",
        fieldSource: "message",
        cropSource: "message",
        memoryEventIds: [],
      },
      memory,
    );
    expect(result.event.field).toBe("New Field");
    expect(result.resolvedFromMemory).toEqual([]);
  });

  it("uses the stored field spelling for one cited match", () => {
    const result = verifyMemoryReferences(
      {
        field: " back   field ",
        crop: null,
        fieldSource: "memory",
        memoryEventIds: [firstEvent.id],
      },
      memory,
    );
    expect(result.event.field).toBe("Back Field");
    expect(result.resolvedFromMemory[0]).toMatchObject({
      field: "field",
      eventId: firstEvent.id,
    });
  });

  it("removes an ambiguous memory field", () => {
    const result = verifyMemoryReferences(
      {
        field: "Back Field",
        crop: null,
        fieldSource: "memory",
        memoryEventIds: [firstEvent.id, "22222222-2222-4222-8222-222222222222"],
      },
      {
        ...memory,
        recentEvents: [
          firstEvent,
          {
            ...firstEvent,
            id: "22222222-2222-4222-8222-222222222222",
            field: "River Field",
          },
        ],
      },
    );
    expect(result.event.field).toBeNull();
    expect(result.unresolvedReferences).toContain("field");
  });

  it("removes invented crops and unknown event ids", () => {
    const result = verifyMemoryReferences(
      {
        field: null,
        crop: "rice",
        cropSource: "memory",
        memoryEventIds: [firstEvent.id, "33333333-3333-4333-8333-333333333333"],
      },
      memory,
    );
    expect(result.event.crop).toBeNull();
    expect(result.event.memoryEventIds).toEqual([firstEvent.id]);
    expect(result.unresolvedReferences).toContain("crop");
  });

  it("resolves a cited crop case-insensitively", () => {
    const result = verifyMemoryReferences(
      {
        field: null,
        crop: "MAIZE",
        cropSource: "memory",
        memoryEventIds: [firstEvent.id],
      },
      memory,
    );
    expect(result.event.crop).toBe("maize");
    expect(result.resolvedFromMemory[0]).toMatchObject({ crop: "crop" });
  });
});
