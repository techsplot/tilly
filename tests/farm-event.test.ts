import { describe, expect, it } from "vitest";
import { extractFarmEvent } from "../src/application/extract-farm-event";
import {
  farmEventCandidateSchema,
  farmEventSchema,
  farmInteractionSchema,
  farmInteractionResultSchema,
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

describe("farm interaction result schema", () => {
  it("accepts a valid farm interaction result", () => {
    const result = farmInteractionResultSchema.safeParse({
      events: [
        {
          activity: "planting",
          crop: "maize",
          field: "Back Field",
          eventDate: "2026-10-06",
          quantity: null,
          unit: null,
          status: "proposed",
          missingFields: [],
          sourceText: "I planted maize yesterday.",
        },
      ],
      clarificationRequired: false,
      clarificationQuestion: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid event data", () => {
    const result = farmInteractionResultSchema.safeParse({
      events: [
        {
          activity: "planting",
          crop: null,
          field: null,
          eventDate: null,
          quantity: null,
          unit: null,
          status: "proposed",
          missingFields: [],
          sourceText: "test",
        },
      ],
      clarificationRequired: false,
      clarificationQuestion: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown activity", () => {
    const result = farmInteractionResultSchema.safeParse({
      events: [
        {
          activity: "unknown_activity",
          crop: null,
          field: null,
          eventDate: null,
          quantity: null,
          unit: null,
          status: "proposed",
          missingFields: [],
          sourceText: "test",
        },
      ],
      clarificationRequired: false,
      clarificationQuestion: null,
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

  it("handles successful event extraction with all required fields", async () => {
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
                      activity: "planting",
                      crop: "maize",
                      field: "Back Field",
                      eventDate: "2026-10-06",
                      quantity: 5,
                      unit: "bags",
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
        "I planted 5 bags of maize in the back field on 2026-10-06.",
        "2026-10-10",
      );

      expect(result.clarificationRequired).toBe(false);
      expect(result.events[0]?.status).toBe("proposed");
      expect(result.events[0]?.crop).toBe("maize");
      expect(result.events[0]?.field).toBe("Back Field");
      expect(result.events[0]?.eventDate).toBe("2026-10-06");
      expect(result.events[0]?.quantity).toBe(5);
      expect(result.events[0]?.unit).toBe("bags");
      expect(result.events[0]?.missingFields).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles clarification answer and returns completed event", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      if (globalThis.fetch.calls === undefined) {
        globalThis.fetch.calls = 0;
      }
      globalThis.fetch.calls++;

      if (globalThis.fetch.calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    events: [
                      {
                        activity: "planting",
                        crop: null,
                        field: null,
                        eventDate: null,
                        quantity: null,
                        unit: null,
                      },
                    ],
                    clarificationRequired: true,
                    clarificationQuestion: "Which field did you plant?",
                  }),
                },
              },
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        );
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  events: [
                    {
                      activity: "planting",
                      crop: "maize",
                      field: "Back Field",
                      eventDate: "2026-10-06",
                      quantity: 5,
                      unit: "bags",
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
    };

    process.env.NEBIUS_API_KEY = "test-key";
    process.env.NEBIUS_MODEL = "test-model";

    try {
      let result = await extractFarmEvent(
        "I planted maize yesterday.",
        "2026-10-10",
      );
      expect(result.clarificationRequired).toBe(true);

      result = await extractFarmEvent(
        "I planted maize yesterday.",
        "2026-10-10",
      );
      expect(result.clarificationRequired).toBe(false);
      expect(result.events[0]?.crop).toBe("maize");
      expect(result.events[0]?.field).toBe("Back Field");
      expect(result.events[0]?.eventDate).toBe("2026-10-06");
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

  it("represents a confirmed event with all fields", () => {
    const result = farmEventSchema.safeParse({
      activity: "harvesting",
      crop: "wheat",
      field: "North Field",
      eventDate: "2026-10-15",
      quantity: 42,
      unit: "bushels",
      status: "confirmed",
      missingFields: [],
      sourceText: "Harvested wheat in the north field.",
    });

    expect(result.success).toBe(true);
  });

  it("represents a rejected event", () => {
    const result = farmEventSchema.safeParse({
      activity: "spraying",
      crop: "corn",
      field: "Main Field",
      eventDate: "2026-10-01",
      quantity: null,
      unit: null,
      status: "rejected",
      missingFields: [],
      sourceText: "Sprayed corn on main field.",
    });

    expect(result.success).toBe(true);
  });
});