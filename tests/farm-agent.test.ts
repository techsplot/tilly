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

import { handleFarmerMessage } from "../src/application/farm-agent";
import {
  listTimeline,
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
  event: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            events: event ? [event] : [],
            clarificationRequired: false,
            clarificationQuestion: null,
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

  it("saves a complete note as confirmed, saved_by agent", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(modelResponse(completeEvent()));

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

    const [row] = await db
      .select()
      .from(farmEvents)
      .where(eq(farmEvents.id, actions[0].event.id));
    expect(row?.savedBy).toBe("agent");
    expect(row?.status).toBe("confirmed");
  });

  it("asks a question for a missing field and saves nothing; the answer then saves it", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse(completeEvent({ field: null })),
    );

    const first = await handleFarmerMessage(db, farmId, {
      message: "I weeded today",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });

    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe("question");
    if (first[0]?.type !== "question") throw new Error("expected question");
    expect(first[0].text).toContain("field");
    expect(await listTimeline(db, farmId)).toEqual([]);

    mockCreate.mockResolvedValueOnce(modelResponse(completeEvent()));
    const second = await handleFarmerMessage(db, farmId, {
      message: "Back Field",
      currentDate: "2026-10-12",
      pending: {
        kind: "clarification",
        originalMessage: "I weeded today",
        clarifications: [{ question: first[0].text, answer: "Back Field" }],
      },
      recentEventIds: [],
    });

    expect(second[0]?.type).toBe("recorded");
  });

  it("asks a question for an unresolved memory reference and saves nothing", async () => {
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
      modelResponse(
        completeEvent({
          field: "Back Field",
          eventDate: "2026-10-13",
          fieldSource: "memory",
          memoryEventIds: [memory.recentEvents[0]!.id],
        }),
      ),
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

  it("saves incomplete when the farmer skips a missing detail", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse(completeEvent({ field: null }), { skip: true }),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "I don't know",
      currentDate: "2026-10-12",
      pending: {
        kind: "clarification",
        originalMessage: "I weeded today",
        clarifications: [{ question: "Which field?", answer: "I don't know" }],
      },
      recentEventIds: [],
    });

    expect(actions[0]?.type).toBe("recorded");
    if (actions[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(actions[0].event.status).toBe("incomplete");
  });

  it("saves incomplete after the third clarification even without skip", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse(completeEvent({ field: null })),
    );

    const actions = await handleFarmerMessage(db, farmId, {
      message: "still not sure",
      currentDate: "2026-10-12",
      pending: {
        kind: "clarification",
        originalMessage: "I weeded today",
        clarifications: [
          { question: "Which field?", answer: "maybe the back one" },
          { question: "Which field?", answer: "not sure" },
          { question: "Which field?", answer: "still not sure" },
        ],
      },
      recentEventIds: [],
    });

    expect(actions[0]?.type).toBe("recorded");
    if (actions[0]?.type !== "recorded") throw new Error("expected recorded");
    expect(actions[0].event.status).toBe("incomplete");
  });

  it("asks again without calling the model when the answer is itself a question", async () => {
    const farmId = await createFarm(db);

    const actions = await handleFarmerMessage(db, farmId, {
      message: "which field do you mean?",
      currentDate: "2026-10-12",
      pending: {
        kind: "clarification",
        originalMessage: "I weeded today",
        clarifications: [{ question: "Which field?", answer: "" }],
      },
      recentEventIds: [],
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(actions[0]).toMatchObject({
      type: "question",
      text: "Which field?",
    });
  });

  it("asks before saving a duplicate, then 'yes' saves and 'no' saves nothing", async () => {
    const farmId = await createFarm(db);
    await recordFarmEvent(db, farmId, {
      proposal: proposal(),
      final: proposal(),
      decision: "confirm",
    });

    mockCreate.mockResolvedValueOnce(modelResponse(completeEvent()));
    const asked = await handleFarmerMessage(db, farmId, {
      message: "I weeded the back field today",
      currentDate: "2026-10-12",
      recentEventIds: [],
    });
    expect(asked[0]?.type).toBe("question");
    if (asked[0]?.type !== "question") throw new Error("expected question");
    expect(asked[0].text).toContain("already recorded");

    mockCreate.mockResolvedValueOnce(modelResponse(completeEvent()));
    const no = await handleFarmerMessage(db, farmId, {
      message: "no",
      currentDate: "2026-10-12",
      pending: asked[0].pending,
      recentEventIds: [],
    });
    expect(no[0]).toEqual({ type: "reply", text: "OK, nothing new recorded." });
    expect(await listTimeline(db, farmId)).toHaveLength(1);

    mockCreate.mockResolvedValueOnce(modelResponse(completeEvent()));
    const yes = await handleFarmerMessage(db, farmId, {
      message: "yes",
      currentDate: "2026-10-12",
      pending: asked[0].pending,
      recentEventIds: [],
    });
    expect(yes[0]?.type).toBe("recorded");
    expect(await listTimeline(db, farmId)).toHaveLength(2);
  });

  it("corrects the most recent session record and reports before/after", async () => {
    const farmId = await createFarm(db);
    const saved = await recordFarmEvent(db, farmId, {
      proposal: proposal(),
      final: proposal(),
      decision: "confirm",
    });

    mockCreate.mockResolvedValueOnce(
      modelResponse(null, {
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
    expect(actions[0].changes).toEqual([
      { field: "field", before: "Back Field", after: "River Field" },
    ]);

    const corrections = await db.select().from(eventCorrections);
    expect(corrections).toHaveLength(1);
  });

  it("replies without changing anything when correct has no valid recent id", async () => {
    const farmId = await createFarm(db);
    mockCreate.mockResolvedValueOnce(
      modelResponse(null, {
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
    mockCreate.mockResolvedValueOnce(modelResponse(null, { intent: "delete" }));

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
    const saved = await recordFarmEvent(db, farmId, {
      proposal: proposal(),
      final: proposal(),
      decision: "confirm",
    });
    mockCreate.mockResolvedValueOnce(modelResponse(null, { intent: "delete" }));

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
    mockCreate.mockResolvedValueOnce(modelResponse(null, { intent: "other" }));

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
