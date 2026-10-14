import { describe, expect, it } from "vitest";
import { extractFarmEvent } from "../src/application/extract-farm-event";
import {
  farmEventCandidateSchema,
  farmEventSchema,
  farmInteractionSchema,
  farmInteractionResultSchema,
  correctEvent,
  correctAgentEvent,
  confirmEvent,
  rejectEvent,
  farmRequestSchema,
  isActionable,
  getImportantMissingDetails,
  deriveTimeOfDay,
  isValidEventTime,
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

  it("accepts clarificationRequired true with null question", () => {
    const result = farmInteractionResultSchema.safeParse({
      events: [],
      clarificationRequired: true,
      clarificationQuestion: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts clarificationRequired true with blank question", () => {
    const result = farmInteractionResultSchema.safeParse({
      events: [],
      clarificationRequired: true,
      clarificationQuestion: "  ",
    });

    expect(result.success).toBe(true);
  });
});

describe("farm request schema", () => {
  it("accepts valid input", () => {
    const result = farmRequestSchema.safeParse({
      message: "I planted maize yesterday",
      currentDate: "2026-10-11",
      clarifications: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty message", () => {
    const result = farmRequestSchema.safeParse({
      message: "",
      currentDate: "2026-10-11",
    });
    expect(result.success).toBe(false);
  });

  it("rejects message over 1000 characters", () => {
    const result = farmRequestSchema.safeParse({
      message: "a".repeat(1001),
      currentDate: "2026-10-11",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed currentDate", () => {
    const result = farmRequestSchema.safeParse({
      message: "test",
      currentDate: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 3 clarifications", () => {
    const result = farmRequestSchema.safeParse({
      message: "test",
      currentDate: "2026-10-11",
      clarifications: [
        { question: "q1", answer: "a1" },
        { question: "q2", answer: "a2" },
        { question: "q3", answer: "a3" },
        { question: "q4", answer: "a4" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty question or answer in clarifications", () => {
    const result = farmRequestSchema.safeParse({
      message: "test",
      currentDate: "2026-10-11",
      clarifications: [{ question: "", answer: "a1" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("farm interaction policy", () => {
  it("marks an incomplete event and asks for the first required field", async () => {
    // TODO: Fix mock to work with new function signature that accepts clarifications
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
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
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
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
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

describe("domain transitions", () => {
  const makeEvent = (
    overrides: Partial<{
      activity:
        | "planting"
        | "fertilizing"
        | "weeding"
        | "spraying"
        | "harvesting"
        | "inspection"
        | "irrigation"
        | "other";
      crop: string | null;
      field: string | null;
      eventDate: string | null;
      quantity: number | null;
      unit: string | null;
      status:
        "proposed" | "incomplete" | "confirmed" | "corrected" | "rejected";
      missingFields: string[];
      sourceText: string;
    }> = {},
  ) => ({
    activity: "planting" as const,
    crop: "maize",
    field: "Back Field",
    eventDate: "2026-10-06",
    quantity: 5,
    unit: "bags",
    status: "proposed" as const,
    missingFields: [],
    sourceText: "I planted maize.",
    ...overrides,
  });

  it("correctEvent completes an unconfirmed event and keeps it proposed", () => {
    const event = makeEvent({
      activity: "planting",
      crop: "maize",
      field: null,
      eventDate: "2026-10-06",
      quantity: null,
      unit: null,
      status: "incomplete",
      missingFields: ["field"],
      sourceText: "I planted maize.",
    });

    const result = correctEvent(event, { field: "Back Field" });
    expect(result.status).toBe("proposed");
    expect(result.field).toBe("Back Field");
    expect(result.missingFields).toEqual([]);
  });

  it("correctEvent with all fields becomes proposed before confirmation", () => {
    const event = makeEvent({
      activity: "planting",
      crop: "maize",
      field: "Back Field",
      eventDate: null,
      quantity: null,
      unit: null,
      status: "incomplete",
      missingFields: ["eventDate"],
      sourceText: "I planted maize.",
    });

    const result = correctEvent(event, { eventDate: "2026-10-06" });
    expect(result.status).toBe("proposed");
    expect(result.missingFields).toEqual([]);
  });

  it("correctEvent with still-missing field stays incomplete", () => {
    const event = makeEvent({
      activity: "planting",
      crop: "maize",
      field: null,
      eventDate: null,
      quantity: null,
      unit: null,
      status: "incomplete",
      missingFields: ["field", "eventDate"],
      sourceText: "I planted maize.",
    });

    const result = correctEvent(event, { field: "Back Field" });
    expect(result.status).toBe("incomplete");
    expect(result.missingFields).toEqual(["eventDate"]);
  });

  it("correctEvent throws on invalid changes", () => {
    const event = makeEvent({
      activity: "planting",
      crop: "maize",
      field: "Back Field",
      eventDate: "2026-10-06",
      quantity: null,
      unit: null,
      status: "incomplete",
      missingFields: [],
      sourceText: "I planted maize.",
    });

    expect(() => correctEvent(event, { eventDate: "not-a-date" })).toThrow();
  });

  it("correctEvent treats cleared fields as missing", () => {
    const event = makeEvent({ status: "proposed" });
    const result = correctEvent(event, { field: "" });
    expect(result.status).toBe("incomplete");
    expect(result.missingFields).toEqual(["field"]);
  });

  it("correctEvent allows confirmed and refuses rejected events", () => {
    expect(correctEvent(makeEvent({ status: "confirmed" }), {}).status).toBe(
      "corrected",
    );
    expect(() => correctEvent(makeEvent({ status: "rejected" }), {})).toThrow();
  });

  it("correcting a confirmed event creates an actionable corrected event", () => {
    expect(correctEvent(makeEvent({ status: "confirmed" }), {}).status).toBe(
      "corrected",
    );
  });

  it("isActionable is true only for confirmed and corrected events", () => {
    expect(isActionable(makeEvent({ status: "confirmed" }))).toBe(true);
    expect(isActionable(makeEvent({ status: "corrected" }))).toBe(true);
    expect(isActionable(makeEvent({ status: "proposed" }))).toBe(false);
    expect(isActionable(makeEvent({ status: "incomplete" }))).toBe(false);
    expect(isActionable(makeEvent({ status: "rejected" }))).toBe(false);
  });

  it("confirmEvent from proposed with no missing fields succeeds", () => {
    const event = makeEvent({
      activity: "planting",
      crop: "maize",
      field: "Back Field",
      eventDate: "2026-10-06",
      quantity: null,
      unit: null,
      status: "proposed",
      missingFields: [],
      sourceText: "I planted maize.",
    });

    const result = confirmEvent(event);
    expect(result.status).toBe("confirmed");
  });

  it("confirmEvent from incomplete is refused", () => {
    const event = makeEvent({
      activity: "planting",
      crop: null,
      field: null,
      eventDate: null,
      quantity: null,
      unit: null,
      status: "incomplete",
      missingFields: ["crop", "field", "eventDate"],
      sourceText: "I planted maize.",
    });

    expect(() => confirmEvent(event)).toThrow(
      "confirmEvent: event has missing fields",
    );
  });

  it("confirmEvent from wrong status is refused", () => {
    const event = makeEvent({
      activity: "planting",
      crop: "maize",
      field: "Back Field",
      eventDate: "2026-10-06",
      quantity: null,
      unit: null,
      status: "rejected",
      missingFields: [],
      sourceText: "I planted maize.",
    });

    expect(() => confirmEvent(event)).toThrow(
      "confirmEvent: only allowed from proposed or corrected status",
    );
  });

  it("rejectEvent works from an unconfirmed status", () => {
    const event = makeEvent({
      activity: "planting",
      crop: "maize",
      field: "Back Field",
      eventDate: "2026-10-06",
      quantity: null,
      unit: null,
      status: "proposed",
      missingFields: [],
      sourceText: "I planted maize.",
    });

    const result = rejectEvent(event);
    expect(result.status).toBe("rejected");
  });

  it("a corrected event cannot be rejected", () => {
    expect(() => rejectEvent(makeEvent({ status: "corrected" }))).toThrow(
      "rejectEvent: cannot reject a confirmed event",
    );
  });

  it("a confirmed event cannot be rejected", () => {
    const event = makeEvent({
      activity: "planting",
      crop: "maize",
      field: "Back Field",
      eventDate: "2026-10-06",
      quantity: null,
      unit: null,
      status: "confirmed",
      missingFields: [],
      sourceText: "I planted maize.",
    });

    expect(() => rejectEvent(event)).toThrow(
      "rejectEvent: cannot reject a confirmed event",
    );
  });
});

describe("clarification flow in extractFarmEvent", () => {
  it("passes clarifications to model and builds sourceText with Q/A pairs", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: string | null = null;

    globalThis.fetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (init?.body) {
        capturedBody = init.body as string;
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
      await extractFarmEvent("I planted maize yesterday.", "2026-10-10", [
        { question: "Which field?", answer: "Back Field" },
      ]);

      expect(capturedBody).toContain("Which field?");
      expect(capturedBody).toContain("Back Field");
      expect(capturedBody).toContain("I planted maize yesterday");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("agent intent schema", () => {
  it("defaults intent to record and skip to false for an older-style response", () => {
    const result = farmInteractionSchema.safeParse({
      events: [],
      clarificationRequired: false,
      clarificationQuestion: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe("record");
      expect(result.data.skip).toBe(false);
      expect(result.data.correction).toBeUndefined();
    }
  });

  it("accepts a correct intent with change fields", () => {
    const result = farmInteractionSchema.safeParse({
      intent: "correct",
      events: [],
      clarificationRequired: false,
      clarificationQuestion: null,
      correction: { changes: { field: "Back Field" } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.correction?.changes.field).toBe("Back Field");
    }
  });

  it("accepts a delete intent", () => {
    const result = farmInteractionSchema.safeParse({
      intent: "delete",
      events: [],
      clarificationRequired: false,
      clarificationQuestion: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown intent", () => {
    const result = farmInteractionSchema.safeParse({
      intent: "made_up",
      events: [],
      clarificationRequired: false,
      clarificationQuestion: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts skip true on an answer that declines a missing detail", () => {
    const result = farmInteractionSchema.safeParse({
      events: [],
      clarificationRequired: false,
      clarificationQuestion: null,
      skip: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skip).toBe(true);
    }
  });

  it("accepts Phase 5 follow-up wording when clarificationQuestion is null", () => {
    const result = farmInteractionSchema.safeParse({
      intent: "record",
      events: [
        {
          activity: "planting",
          crop: "maize",
          field: null,
          eventDate: null,
          quantity: null,
          unit: null,
        },
      ],
      clarificationRequired: true,
      clarificationQuestion: null,
      followUpQuestion: "Got it, planting maize. Which field was it, and when?",
    });

    expect(result.success).toBe(true);
  });
});

describe("important missing details (finding 8)", () => {
  it("requires only the activity for 'other'", () => {
    expect(
      getImportantMissingDetails({
        activity: "other",
        crop: null,
        field: null,
        eventDate: "2026-10-12",
      }),
    ).toEqual([]);
  });

  it("requires crop and field for spraying, and the date always", () => {
    expect(
      getImportantMissingDetails({
        activity: "spraying",
        crop: null,
        field: null,
        eventDate: null,
      }),
    ).toEqual(["eventDate", "crop", "field"]);
  });

  it("requires only field for inspection and irrigation", () => {
    expect(
      getImportantMissingDetails({
        activity: "inspection",
        crop: null,
        field: null,
        eventDate: "2026-10-12",
      }),
    ).toEqual(["field"]);
  });

  it("treats an unresolved memory reference as important", () => {
    expect(
      getImportantMissingDetails(
        {
          activity: "weeding",
          crop: "maize",
          field: "Back Field",
          eventDate: "2026-10-12",
        },
        ["field"],
      ),
    ).toEqual(["field"]);
  });

  it("returns nothing when every important detail is present", () => {
    expect(
      getImportantMissingDetails({
        activity: "weeding",
        crop: "maize",
        field: "Back Field",
        eventDate: "2026-10-12",
      }),
    ).toEqual([]);
  });
});

describe("time of day (finding 17)", () => {
  it("validates strict HH:MM", () => {
    expect(isValidEventTime("16:00")).toBe(true);
    expect(isValidEventTime("4pm")).toBe(false);
    expect(isValidEventTime("24:00")).toBe(false);
    expect(isValidEventTime("09:60")).toBe(false);
  });

  it("derives the boundary buckets", () => {
    expect(deriveTimeOfDay("05:00")).toBe("morning");
    expect(deriveTimeOfDay("11:59")).toBe("morning");
    expect(deriveTimeOfDay("12:00")).toBe("afternoon");
    expect(deriveTimeOfDay("16:59")).toBe("afternoon");
    expect(deriveTimeOfDay("17:00")).toBe("evening");
    expect(deriveTimeOfDay("20:59")).toBe("evening");
    expect(deriveTimeOfDay("21:00")).toBe("night");
    expect(deriveTimeOfDay("04:59")).toBe("night");
  });
});

describe("correctAgentEvent (finding 11)", () => {
  const makeAgentEvent = (
    overrides: Partial<{
      crop: string | null;
      field: string | null;
      eventDate: string | null;
      dateAssumed: boolean;
      eventTime: string | null;
      timeOfDay: "morning" | "afternoon" | "evening" | "night" | null;
      missingFields: string[];
      status: "confirmed" | "corrected" | "rejected";
    }> = {},
  ) => ({
    activity: "spraying" as const,
    crop: "maize",
    field: "Back Field",
    eventDate: "2026-10-12",
    quantity: null,
    unit: null,
    status: "confirmed" as const,
    missingFields: [] as string[],
    sourceText: "I sprayed the back field today",
    dateAssumed: false,
    eventTime: null,
    timeOfDay: null,
    ...overrides,
  });

  it("a gap never demotes the record to incomplete", () => {
    const result = correctAgentEvent(
      makeAgentEvent({ field: "River Field" }),
      { crop: null },
      "2026-10-12",
    );
    expect(result.status).toBe("corrected");
    expect(result.missingFields).toEqual(["crop"]);
  });

  it("a correction to the date clears date_assumed", () => {
    const assumed = makeAgentEvent({ dateAssumed: true });
    const result = correctAgentEvent(
      assumed,
      { eventDate: "2026-10-10" },
      "2026-10-12",
    );
    expect(result.dateAssumed).toBe(false);
    expect(result.missingFields).toEqual([]);
  });

  it("clearing the date re-assumes the current date", () => {
    const result = correctAgentEvent(
      makeAgentEvent(),
      { eventDate: null },
      "2026-10-15",
    );
    expect(result.eventDate).toBe("2026-10-15");
    expect(result.dateAssumed).toBe(true);
    expect(result.missingFields).toEqual(["eventDate"]);
  });

  it("accepts an explicit time and derives time_of_day, ignoring any stale value", () => {
    const result = correctAgentEvent(
      makeAgentEvent({ timeOfDay: "morning" }),
      { eventTime: "16:00" },
      "2026-10-12",
    );
    expect(result.eventTime).toBe("16:00");
    expect(result.timeOfDay).toBe("afternoon");
  });

  it("accepts a qualitative time of day with no exact time", () => {
    const result = correctAgentEvent(
      makeAgentEvent(),
      { timeOfDay: "evening" },
      "2026-10-12",
    );
    expect(result.eventTime).toBeNull();
    expect(result.timeOfDay).toBe("evening");
  });

  it("refuses to edit a rejected event", () => {
    expect(() =>
      correctAgentEvent(
        makeAgentEvent({ status: "rejected" as never }),
        { crop: "rice" },
        "2026-10-12",
      ),
    ).toThrow("correctAgentEvent: cannot edit a rejected event");
  });
});
