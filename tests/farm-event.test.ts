import { describe, expect, it } from "vitest";
import { extractFarmEvent } from "../src/application/extract-farm-event";
import {
  farmEventCandidateSchema,
  farmEventSchema,
  farmInteractionSchema,
} from "../src/domain/farm-event";

describe("farm interaction schema", () => {
  it("accepts a clear planting event", () => {
    const result = farmInteractionSchema.safeParse({
      events: [
        {
          activity: "planting",
          crop: "maize",
          field: "Back Field",
          eventDate: "2026-10-06",
          quantity: null,
          unit: null,
        },
      ],
      clarificationRequired: false,
      clarificationQuestion: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts an explicit clarification response", () => {
    const result = farmInteractionSchema.safeParse({
      events: [],
      clarificationRequired: true,
      clarificationQuestion: "Which field did you spray?",
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown activities", () => {
    const result = farmInteractionSchema.safeParse({
      events: [
        {
          activity: "made_up_activity",
          crop: null,
          field: null,
          eventDate: null,
          quantity: null,
          unit: null,
        },
      ],
      clarificationRequired: false,
      clarificationQuestion: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects relative, malformed, or impossible event dates", () => {
    for (const eventDate of ["yesterday", "10/10/2026", "2026-02-30"]) {
      const result = farmEventCandidateSchema.safeParse({
        activity: "planting",
        crop: "maize",
        field: "Back Field",
        eventDate,
        quantity: null,
        unit: null,
      });

      expect(result.success, eventDate).toBe(false);
    }
  });

  it("rejects blank crop and field values", () => {
    const result = farmEventCandidateSchema.safeParse({
      activity: "planting",
      crop: " ",
      field: "",
      eventDate: "2026-10-10",
      quantity: null,
      unit: null,
    });

    expect(result.success).toBe(false);
  });
});

describe("farm interaction policy", () => {
  it("marks an incomplete event and asks for the first required field", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
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
                  clarificationRequired: false,
                  clarificationQuestion: null,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    process.env.NEBIUS_API_KEY = "test-key";
    process.env.NEBIUS_MODEL = "test-model";

    try {
      const result = await extractFarmEvent(
        "I sprayed the farm.",
        "2026-10-10",
      );

      expect(result.clarificationRequired).toBe(true);
      expect(result.clarificationQuestion).toContain("crop");
      expect(result.events[0]?.status).toBe("incomplete");
      expect(result.events[0]?.missingFields).toEqual([
        "crop",
        "field",
        "eventDate",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("farm event lifecycle schema", () => {
  it("represents an incomplete event with its source and missing fields", () => {
    const result = farmEventSchema.safeParse({
      activity: "planting",
      crop: "maize",
      field: null,
      eventDate: "2026-10-10",
      quantity: null,
      unit: null,
      status: "incomplete",
      missingFields: ["field"],
      sourceText: "I planted maize yesterday.",
    });

    expect(result.success).toBe(true);
  });
});
