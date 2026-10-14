import { PGlite } from "@electric-sql/pglite";
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
  getNebiusModel: vi.fn((role: string) =>
    role === "answer" ? "answer-model" : "extract-model",
  ),
}));

import {
  answerQuestion,
  generateReport,
} from "../src/application/farm-question";
import { recordAgentEvent } from "../src/application/persist-farm-event";
import { createTestFarm as createFarm } from "./test-helpers";
import { eventCorrections, farmEvents } from "../src/infrastructure/db/schema";
import * as schema from "../src/infrastructure/db/schema";

const migrationFolder = "drizzle";

function modelAnswer(answer: string, citedRecordIds: string[]) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({ answer, citedRecordIds }),
        },
      },
    ],
  };
}

async function saveEvent(
  db: ReturnType<typeof drizzle<typeof schema>>,
  farmId: string,
  overrides: Partial<{
    activity: "planting" | "spraying" | "weeding";
    crop: string | null;
    field: string | null;
    eventDate: string | null;
  }> = {},
) {
  const { event } = await recordAgentEvent(db, farmId, {
    final: {
      activity: overrides.activity ?? "spraying",
      crop: overrides.crop ?? "maize",
      field: overrides.field ?? "River Field",
      eventDate: overrides.eventDate ?? "2026-10-14",
      quantity: null,
      unit: null,
      status: "confirmed",
      missingFields: [],
      sourceText: "seed",
    },
    currentDate: "2026-10-14",
  });
  return event;
}

describe("farm question answering", () => {
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
    await db.delete(farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("answers from returned records and exposes only valid cited records", async () => {
    const farmId = await createFarm(db);
    const saved = await saveEvent(db, farmId);
    mockCreate.mockResolvedValueOnce(
      modelAnswer("You sprayed maize in River Field today.", [
        saved.id,
        "not-a-real-record",
      ]),
    );

    const result = await answerQuestion(db, farmId, {
      activity: "spraying",
      dateFrom: "2026-10-14",
      dateTo: "2026-10-14",
    });

    expect(result.text).toBe("You sprayed maize in River Field today.");
    expect(result.citedRecords).toEqual([
      {
        id: saved.id,
        activity: "spraying",
        crop: "maize",
        field: "River Field",
        eventDate: "2026-10-14",
        eventTime: null,
        timeOfDay: null,
      },
    ]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "answer-model" }),
    );
  });

  it("does not call the answer model when records cannot answer", async () => {
    const farmId = await createFarm(db);

    const result = await answerQuestion(db, farmId, {
      activity: "spraying",
      dateFrom: "2026-10-14",
      dateTo: "2026-10-14",
    });

    expect(result).toEqual({
      text: "I can't tell from your records.",
      citedRecords: [],
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects factual model answers that cite no returned records", async () => {
    const farmId = await createFarm(db);
    await saveEvent(db, farmId);
    mockCreate.mockResolvedValueOnce(
      modelAnswer("You sprayed maize in River Field today.", [
        "not-a-real-record",
      ]),
    );

    await expect(
      answerQuestion(db, farmId, { activity: "spraying" }),
    ).rejects.toThrow("Model answer did not cite any returned records.");
  });

  it("generates reports from deterministic aggregates and cites counted records", async () => {
    const farmId = await createFarm(db);
    const first = await saveEvent(db, farmId, {
      activity: "spraying",
      field: "River Field",
    });
    const second = await saveEvent(db, farmId, {
      activity: "weeding",
      field: "Back Field",
    });
    mockCreate.mockResolvedValueOnce(
      modelAnswer("You have 2 records: 1 spraying and 1 weeding.", [
        first.id,
        second.id,
      ]),
    );

    const result = await generateReport(db, farmId, {
      reportType: "by_activity",
      dateFrom: "2026-10-14",
      dateTo: "2026-10-14",
    });

    expect(result.text).toBe("You have 2 records: 1 spraying and 1 weeding.");
    expect(result.citedRecords.map((record) => record.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    const prompt = mockCreate.mock.calls[0]?.[0].messages[1].content as string;
    expect(prompt).toContain("Total records: 2");
    expect(prompt).toContain("spraying: 1");
    expect(prompt).toContain("weeding: 1");
  });
});
