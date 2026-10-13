import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("../src/infrastructure/nebius/nebius-client", () => ({
  createNebiusClient: vi.fn(() => ({
    chat: { completions: { create: mockCreate } },
  })),
  getNebiusModel: vi.fn(() => "test-model"),
}));

import {
  buildFollowUpQuestion,
  buildNudgeQuestion,
  getNudge,
  handleFarmerMessage,
  type Pending,
} from "../src/application/farm-agent";
import {
  listTimeline,
  recordAgentEvent,
  recordFarmEvent,
} from "../src/application/persist-farm-event";
import { loadFarmMemory } from "../src/application/farm-memory";
import * as schema from "../src/infrastructure/db/schema";
import { eventCorrections, farmEvents } from "../src/infrastructure/db/schema";
import { createFarm } from "../src/infrastructure/db/farm-event-repository";

const migrationFolder = "drizzle";

function proposal(
  overrides: Partial<{
    crop: string | null;
    field: string | null;
    eventDate: string | null;
  }> = {},
) {
  return {
    activity: "weeding" as const,
    crop: "maize",
    field: "Back Field",
    eventDate: "2026-10-12",
    quantity: null,
    unit: null,
    status: "proposed" as const,
    missingFields: [] as string[],
    sourceText: "seed",
    ...overrides,
  };
}

function modelResponse(
  events: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            events,
            clarificationRequired: false,
            clarificationQuestion: null,
            followUpQuestion: null,
            ...extra,
          }),
        },
      },
    ],
  };
}

function completeEvent(overrides: Record<string, unknown> = {}) {
  return {
    activity: "weeding",
    crop: "maize",
    field: "Back Field",
    eventDate: "2026-10-12",
    quantity: null,
    unit: null,
    ...overrides,
  };
}

function sprayEvent(overrides: Record<string, unknown> = {}) {
  return {
    activity: "spraying",
    crop: "maize",
    field: null,
    eventDate: null,
    quantity: null,
    unit: null,
    ...overrides,
  };
}

describe("farm agent service", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationFolder });
  }, 180000);

  beforeEach(async () => {
    mockCreate.mockReset();
    await db.delete(eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("saves a complete note as confirmed, saved_by agent, no question", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([completeEvent()]));

    const actions = await handleFarmerMessage(db, farmId, {
      message: "I weeded the back field today",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "recorded" });
    if (actions[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(actions[0].event.status).toBe("confirmed");
    expect(actions[0].event.savedBy).toBe("agent");
    expect(actions[0].event.missingFields).toEqual([]);

    const [row] = await db
      .select()
      .from(farmEvents)
      .where(eq(farmEvents.id, actions[0].event.id));
    expect(row?.savedBy).toBe("agent");
    expect(row?.status).toBe("confirmed");
  });

  it("saves eventTime and the derived time_of_day end to end (finding 17)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse([
        completeEvent({ eventTime: "16:00", timeOfDay: "morning" }),
      ]),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "I weeded the back field at 4pm",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(actions[0]?.type).toBe("recorded");
    if (actions[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(actions[0].event.eventTime).toBe("16:00");
    expect(actions[0].event.timeOfDay).toBe("afternoon");
  });

  it("asks one question mentioning both missing details, then saves with the given detail and date_assumed (finding 8, 9, 11)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse([sprayEvent()], { followUpQuestion: null }),
    );

    const first = await handleFarmerMessage(db, farmId, {
      message: "I sprayed",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe("question");
    if (first[0]?.type !== "question") throw new Error("expected question");
    expect(first[0].text).toContain("field");
    expect(first[0].text).toContain("when");
    expect(await listTimeline(db, farmId)).toEqual([]);

    mockCreate.mockResolvedValueOnce(
      modelResponse([sprayEvent({ field: "Back Field" })]),
    );
    const second = await handleFarmerMessage(db, farmId, {
      message: "Back Field",
      currentDate: "2026-10-12",
      pending: first[0].pending,
      recentEventIds: [],
    });

    expect(second).toHaveLength(1);
    expect(second[0]?.type).toBe("recorded");
    if (second[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(second[0].event.field).toBe("Back Field");
    expect(second[0].event.eventDate).toBe("2026-10-12");
    expect(second[0].event.dateAssumed).toBe(true);
    expect(second[0].event.missingFields).toContain("eventDate");
    expect(second[0].event.status).toBe("confirmed");

    const request = mockCreate.mock.calls[1]![0];
    const body = JSON.parse(request.messages[1].content);
    expect(body.clarifications).toEqual([
      { question: first[0].text, answer: "Back Field" },
    ]);
  });

  it("'I don't know' to the question saves with gaps and asks nothing again (finding 10)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([sprayEvent()]));
    const first = await handleFarmerMessage(db, farmId, {
      message: "I sprayed",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });
    if (first[0]?.type !== "question") throw new Error("expected question");

    mockCreate.mockResolvedValueOnce(
      modelResponse([sprayEvent()], { skip: true }),
    );
    const second = await handleFarmerMessage(db, farmId, {
      message: "I don't know",
      currentDate: "2026-10-12",
      pending: first[0].pending,
      recentEventIds: [],
    });

    expect(second).toHaveLength(1);
    expect(second[0]?.type).toBe("recorded");
    if (second[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(second[0].event.field).toBeNull();
    expect(second[0].event.missingFields).toContain("field");
    expect(second[0].event.status).toBe("confirmed");
  });

  it("a question-like reply saves with gaps instead of asking again (finding 3, 10)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse([sprayEvent({ eventDate: "2026-10-12" })]),
    );
    const first = await handleFarmerMessage(db, farmId, {
      message: "I sprayed",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });
    if (first[0]?.type !== "question") throw new Error("expected question");

    mockCreate.mockResolvedValueOnce(
      modelResponse([sprayEvent({ eventDate: "2026-10-12" })]),
    );
    const second = await handleFarmerMessage(db, farmId, {
      message: "why do you need that?",
      currentDate: "2026-10-12",
      pending: first[0].pending,
      recentEventIds: [],
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(second).toHaveLength(1);
    expect(second[0]?.type).toBe("recorded");
  });

  it("saves a note with two complete activities as two recorded actions (finding 1, 14)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse([
        completeEvent({ activity: "weeding" }),
        completeEvent({ activity: "spraying", field: "River Field" }),
      ]),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "I weeded and sprayed today",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]?.type).toBe("recorded");
    expect(actions[1]?.type).toBe("recorded");
    expect(await listTimeline(db, farmId)).toHaveLength(2);
  });

  it("saves the complete activity and asks about the incomplete one (finding 1, 14)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse([
        completeEvent({ activity: "weeding" }),
        sprayEvent({ eventDate: "2026-10-12" }),
      ]),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "I weeded the back field and sprayed",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]?.type).toBe("recorded");
    expect(actions[1]?.type).toBe("question");
    expect(await listTimeline(db, farmId)).toHaveLength(1);
  });

  it("ends a pending note with gaps when the next message is a different note (finding 10)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([sprayEvent()]));
    const first = await handleFarmerMessage(db, farmId, {
      message: "I sprayed",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });
    if (first[0]?.type !== "question") throw new Error("expected question");

    mockCreate.mockResolvedValueOnce(
      modelResponse([
        completeEvent({ activity: "weeding", field: "River Field" }),
      ]),
    );
    const second = await handleFarmerMessage(db, farmId, {
      message: "I also weeded the river field",
      currentDate: "2026-10-12",
      pending: first[0].pending,
      recentEventIds: [],
    });

    expect(second).toHaveLength(2);
    expect(second[0]?.type).toBe("recorded");
    if (second[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(second[0].event.activity).toBe("spraying");
    expect(second[0].event.missingFields).toEqual(
      expect.arrayContaining(["field", "eventDate"]),
    );
    expect(second[1]?.type).toBe("recorded");
    if (second[1]?.type !== "recorded") throw new Error("expected recorded");
    expect(second[1].event.activity).toBe("weeding");
    expect(await listTimeline(db, farmId)).toHaveLength(2);
  });

  it("keeps every activity when the reply returns the pending one plus another (review 2, finding 2)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([sprayEvent()]));
    const first = await handleFarmerMessage(db, farmId, {
      message: "I sprayed",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });
    if (first[0]?.type !== "question") throw new Error("expected question");

    mockCreate.mockResolvedValueOnce(
      modelResponse([
        sprayEvent(),
        completeEvent({ activity: "weeding", field: "River Field" }),
      ]),
    );
    const second = await handleFarmerMessage(db, farmId, {
      message: "I also weeded the river field",
      currentDate: "2026-10-12",
      pending: first[0].pending,
      recentEventIds: [],
    });

    expect(second.map((action) => action.type)).toEqual([
      "recorded",
      "recorded",
    ]);
    const timeline = await listTimeline(db, farmId);
    expect(timeline.map((event) => event.activity).sort()).toEqual([
      "spraying",
      "weeding",
    ]);
    const spraying = timeline.find((event) => event.activity === "spraying");
    expect(spraying?.field).toBeNull();
    expect(spraying?.missingFields).toContain("field");
  });

  it("ends the pending note when the reply returns only the pending activity (review 2, finding 2)", async () => {
    // Chosen behavior: the code only sees what the model returns. If the
    // model folds the reply into the pending spraying note and drops the
    // weeding, the spraying note is saved with what the model merged, no
    // question is asked again, and nothing is invented for the weeding.
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([sprayEvent()]));
    const first = await handleFarmerMessage(db, farmId, {
      message: "I sprayed",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });
    if (first[0]?.type !== "question") throw new Error("expected question");

    mockCreate.mockResolvedValueOnce(modelResponse([sprayEvent()]));
    const second = await handleFarmerMessage(db, farmId, {
      message: "I also weeded the river field",
      currentDate: "2026-10-12",
      pending: first[0].pending,
      recentEventIds: [],
    });

    expect(second).toHaveLength(1);
    expect(second[0]?.type).toBe("recorded");
    if (second[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(second[0].event.activity).toBe("spraying");
    expect(second[0].event.missingFields).toContain("field");
    expect(await listTimeline(db, farmId)).toHaveLength(1);
  });

  it("an 'other' reply to the question saves the note with gaps and no unsupported text (review 2, finding 2)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([sprayEvent()]));
    const first = await handleFarmerMessage(db, farmId, {
      message: "I sprayed",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });
    if (first[0]?.type !== "question") throw new Error("expected question");

    mockCreate.mockResolvedValueOnce(modelResponse([], { intent: "other" }));
    const second = await handleFarmerMessage(db, farmId, {
      message: "I don't know",
      currentDate: "2026-10-12",
      pending: first[0].pending,
      recentEventIds: [],
    });

    expect(second).toHaveLength(1);
    expect(second[0]?.type).toBe("recorded");
    if (second[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(second[0].event.activity).toBe("spraying");
    expect(second[0].event.missingFields).toContain("field");
    expect(JSON.stringify(second)).not.toContain("coming soon");
  });

  it("asks a question for an unresolved memory reference (finding 8)", async () => {
    const farmId = await createFarm(db);
    await recordFarmEvent(db, farmId, {
      proposal: proposal({ field: "Back Field" }),
      final: proposal({ field: "Back Field" }),
      decision: "confirm",
    });
    await recordFarmEvent(db, farmId, {
      proposal: proposal({ field: "River Field" }),
      final: proposal({ field: "River Field" }),
      decision: "confirm",
    });
    const memory = await loadFarmMemory(db, farmId, "2026-10-13");

    mockCreate.mockResolvedValueOnce(
      modelResponse([
        completeEvent({
          field: "Back Field",
          eventDate: "2026-10-13",
          fieldSource: "memory",
          memoryEventIds: [memory.recentEvents[0]!.id],
        }),
      ]),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "I weeded that field",
      currentDate: "2026-10-13",
      recentEventIds: [],
    });

    expect(actions[0]?.type).toBe("question");
    const timeline = await listTimeline(db, farmId);
    expect(timeline).toHaveLength(2);
  });

  it("saves a repeat and flags it instead of asking (finding 13)", async () => {
    const farmId = await createFarm(db);
    await recordFarmEvent(db, farmId, {
      proposal: proposal(),
      final: proposal(),
      decision: "confirm",
    });

    mockCreate.mockResolvedValueOnce(modelResponse([completeEvent()]));
    const actions = await handleFarmerMessage(db, farmId, {
      message: "I weeded the back field today",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "recorded",
      possibleDuplicate: true,
    });
    expect(await listTimeline(db, farmId)).toHaveLength(2);
  });

  it("corrects the most recent session record and reports before/after", async () => {
    const farmId = await createFarm(db);
    const { event: saved } = await recordAgentEvent(db, farmId, {
      final: proposal(),
      currentDate: "2026-10-12",
    });

    mockCreate.mockResolvedValueOnce(
      modelResponse([], {
        intent: "correct",
        correction: { changes: { field: "River Field" } },
      }),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "no, it was the river field",
      currentDate: "2026-10-12",
      recentEventIds: [saved.id],
    });

    expect(actions[0]?.type).toBe("corrected");
    if (actions[0]?.type !== "corrected") throw new Error("expected corrected");
    expect(actions[0].event.field).toBe("River Field");
    expect(actions[0].event.status).toBe("corrected");
    expect(actions[0].changes).toEqual([
      { field: "field", before: "Back Field", after: "River Field" },
    ]);
    expect(actions[0].correctionId).not.toBeNull();

    const corrections = await db.select().from(eventCorrections);
    expect(corrections).toHaveLength(1);
  });

  it("'that's wrong' then 'river field' corrects the original and saves nothing new (review 2, finding 1)", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([completeEvent()]));
    const first = await handleFarmerMessage(db, farmId, {
      message: "I weeded the back field today",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });
    if (first[0]?.type !== "recorded") throw new Error("expected recorded");
    const original = first[0].event;

    mockCreate.mockResolvedValueOnce(
      modelResponse([], { intent: "correct", correction: { changes: {} } }),
    );
    const second = await handleFarmerMessage(db, farmId, {
      message: "that's wrong",
      currentDate: "2026-10-12",
      recentEventIds: [original.id],
    });
    expect(second).toEqual([
      {
        type: "question",
        text: "What should I change it to?",
        pending: { kind: "correction", eventId: original.id },
      },
    ]);
    if (second[0]?.type !== "question") throw new Error("expected question");

    mockCreate.mockResolvedValueOnce(
      modelResponse([], {
        intent: "correct",
        correction: { changes: { field: "River Field" } },
      }),
    );
    const third = await handleFarmerMessage(db, farmId, {
      message: "river field",
      currentDate: "2026-10-12",
      pending: second[0].pending,
      recentEventIds: [original.id],
    });

    expect(third).toHaveLength(1);
    expect(third[0]?.type).toBe("corrected");
    if (third[0]?.type !== "corrected") throw new Error("expected corrected");
    expect(third[0].event.id).toBe(original.id);
    expect(third[0].changes).toEqual([
      { field: "field", before: "Back Field", after: "River Field" },
    ]);

    const timeline = await listTimeline(db, farmId);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.id).toBe(original.id);
    expect(timeline[0]?.field).toBe("River Field");
    const corrections = await db.select().from(eventCorrections);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.eventId).toBe(original.id);
  });

  it("a correction answer the model restates as a record changes only differing values (review 2, finding 1)", async () => {
    const farmId = await createFarm(db);
    const { event: saved } = await recordAgentEvent(db, farmId, {
      final: proposal(),
      currentDate: "2026-10-12",
    });
    const pending: Pending = { kind: "correction", eventId: saved.id };

    mockCreate.mockResolvedValueOnce(
      modelResponse([completeEvent({ field: "River Field" })]),
    );
    const actions = await handleFarmerMessage(db, farmId, {
      message: "river field",
      currentDate: "2026-10-12",
      pending,
      recentEventIds: [],
    });

    expect(actions[0]?.type).toBe("corrected");
    if (actions[0]?.type !== "corrected") throw new Error("expected corrected");
    expect(actions[0].changes).toEqual([
      { field: "field", before: "Back Field", after: "River Field" },
    ]);
    expect(await listTimeline(db, farmId)).toHaveLength(1);
  });

  it("a correction answer with no usable change leaves the record and asks nothing (review 2, finding 1)", async () => {
    const farmId = await createFarm(db);
    const { event: saved } = await recordAgentEvent(db, farmId, {
      final: proposal(),
      currentDate: "2026-10-12",
    });
    const pending: Pending = { kind: "correction", eventId: saved.id };

    mockCreate.mockResolvedValueOnce(modelResponse([], { intent: "other" }));
    const actions = await handleFarmerMessage(db, farmId, {
      message: "never mind",
      currentDate: "2026-10-12",
      pending,
      recentEventIds: [],
    });

    expect(actions).toEqual([
      {
        type: "reply",
        text: "I didn't catch what to change, so I left that record as it was.",
      },
    ]);
    expect(await listTimeline(db, farmId)).toHaveLength(1);
    expect(await db.select().from(eventCorrections)).toHaveLength(0);
  });

  it("replies without changing anything when correct has no valid recent id", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse([], {
        intent: "correct",
        correction: { changes: { field: "River Field" } },
      }),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "no, it was the river field",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(actions[0]).toEqual({
      type: "reply",
      text: "I don't have a recent record to change. Tell me what you did.",
    });
  });

  it("replies without changing anything when delete has no valid recent id", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([], { intent: "delete" }));

    const actions = await handleFarmerMessage(db, farmId, {
      message: "delete that",
      currentDate: "2026-10-12",
      recentEventIds: ["11111111-1111-4111-8111-111111111111"],
    });

    expect(actions[0]).toEqual({
      type: "reply",
      text: "I don't have a recent record to change. Tell me what you did.",
    });
  });

  it("soft-deletes the target record, removing it from the timeline and memory", async () => {
    const farmId = await createFarm(db);
    const { event: saved } = await recordAgentEvent(db, farmId, {
      final: proposal(),
      currentDate: "2026-10-12",
    });
    mockCreate.mockResolvedValueOnce(modelResponse([], { intent: "delete" }));

    const actions = await handleFarmerMessage(db, farmId, {
      message: "delete that",
      currentDate: "2026-10-12",
      recentEventIds: [saved.id],
    });

    expect(actions[0]?.type).toBe("deleted");
    expect(await listTimeline(db, farmId)).toEqual([]);
    const memory = await loadFarmMemory(db, farmId, "2026-10-12");
    expect(memory.recentEvents).toEqual([]);
    const corrections = await db.select().from(eventCorrections);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.after).toEqual({ deleted: true });
  });

  it("replies and saves nothing for an unsupported intent", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse([], { intent: "other" }));

    const actions = await handleFarmerMessage(db, farmId, {
      message: "hello",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(actions[0]).toEqual({
      type: "reply",
      text: "I can record farm activities for now. Questions and reminders are coming soon.",
    });
    expect(await listTimeline(db, farmId)).toEqual([]);
  });

  it("propagates a model failure and saves nothing", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockRejectedValueOnce(new Error("model down"));

    await expect(
      handleFarmerMessage(db, farmId, {
        message: "I weeded the back field today",
        currentDate: "2026-10-12",
        recentEventIds: [],
      }),
    ).rejects.toThrow("model down");
    expect(await listTimeline(db, farmId)).toEqual([]);
  });

  it("propagates invalid model output and saves nothing", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json" } }],
    });

    await expect(
      handleFarmerMessage(db, farmId, {
        message: "I weeded the back field today",
        currentDate: "2026-10-12",
        recentEventIds: [],
      }),
    ).rejects.toThrow();
    expect(await listTimeline(db, farmId)).toEqual([]);
  });
});

describe("gap reminders (finding 12)", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationFolder });
  }, 180000);

  beforeEach(async () => {
    mockCreate.mockReset();
    await db.delete(eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  async function saveGappyEvent(farmId: string) {
    const { event } = await recordAgentEvent(db, farmId, {
      final: {
        activity: "spraying",
        crop: "maize",
        field: null,
        eventDate: "2026-10-10",
        quantity: null,
        unit: null,
        status: "confirmed",
        missingFields: [],
        sourceText: "I sprayed",
      },
      currentDate: "2026-10-10",
    });
    return event;
  }

  it("returns nothing when there is no gap to ask about", async () => {
    const farmId = await createFarm(db);
    expect(await getNudge(db, farmId)).toBeNull();
  });

  it("returns at most one record, naming the actual gap", async () => {
    const farmId = await createFarm(db);
    const saved = await saveGappyEvent(farmId);

    const nudge = await getNudge(db, farmId);
    expect(nudge).not.toBeNull();
    expect(nudge?.pending).toEqual({ kind: "gap", eventId: saved.id });
    expect(nudge?.text).toContain("field");
  });

  it("skips a record nudged within the last 24 hours", async () => {
    const farmId = await createFarm(db);
    await saveGappyEvent(farmId);
    const first = await getNudge(db, farmId);
    expect(first).not.toBeNull();

    expect(await getNudge(db, farmId)).toBeNull();
  });

  it("surfaces the record again after 24 hours", async () => {
    const farmId = await createFarm(db);
    const saved = await saveGappyEvent(farmId);
    await getNudge(db, farmId);
    await db
      .update(farmEvents)
      .set({ lastNudgedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(farmEvents.id, saved.id));

    const nudge = await getNudge(db, farmId);
    expect(nudge?.pending).toEqual({ kind: "gap", eventId: saved.id });
  });

  it("skips a deleted record and another farm's record", async () => {
    const farmId = await createFarm(db);
    const otherFarmId = await createFarm(db);
    const saved = await saveGappyEvent(farmId);
    await saveGappyEvent(otherFarmId);
    await db
      .update(farmEvents)
      .set({ deletedAt: new Date() })
      .where(eq(farmEvents.id, saved.id));

    expect(await getNudge(db, farmId)).toBeNull();
  });

  it("answering a nudge corrects the record and clears the gap", async () => {
    const farmId = await createFarm(db);
    const saved = await saveGappyEvent(farmId);
    const pending: Pending = { kind: "gap", eventId: saved.id };

    mockCreate.mockResolvedValueOnce(
      modelResponse([
        sprayEvent({ field: "Back Field", eventDate: "2026-10-10" }),
      ]),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "Back Field",
      currentDate: "2026-10-12",
      pending,
      recentEventIds: [],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe("corrected");
    if (actions[0]?.type !== "corrected") throw new Error("expected corrected");
    expect(actions[0].event.field).toBe("Back Field");
    expect(actions[0].event.missingFields).toEqual([]);
  });

  it("'stop asking' stops the nudge without a model call", async () => {
    const farmId = await createFarm(db);
    const saved = await saveGappyEvent(farmId);
    const pending: Pending = { kind: "gap", eventId: saved.id };

    const actions = await handleFarmerMessage(db, farmId, {
      message: "stop asking",
      currentDate: "2026-10-12",
      pending,
      recentEventIds: [],
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(actions).toEqual([
      { type: "reply", text: "OK, I won't ask about that again." },
    ]);

    const [row] = await db
      .select()
      .from(farmEvents)
      .where(eq(farmEvents.id, saved.id));
    expect(row?.nudgesStopped).toBe(true);
    expect(await getNudge(db, farmId)).toBeNull();
  });
});

describe("question phrasing helpers", () => {
  it("builds a fallback question covering all missing details", () => {
    expect(buildFollowUpQuestion(null, ["eventDate", "field"])).toBe(
      "Got it. Can you tell me when it was and which field?",
    );
    expect(buildFollowUpQuestion("  ", ["crop"])).toBe(
      "Got it. Can you tell me which crop?",
    );
  });

  it("prefers the model's phrasing when present", () => {
    expect(
      buildFollowUpQuestion("Got it, spraying. Which field was it?", ["field"]),
    ).toBe("Got it, spraying. Which field was it?");
  });

  it("builds fixed nudge wording from the record", () => {
    expect(
      buildNudgeQuestion({
        activity: "spraying",
        eventDate: "2026-10-10",
        missingFields: ["field"],
      }),
    ).toBe("Quick one: which field did you spray on 10 Oct?");
  });
});
