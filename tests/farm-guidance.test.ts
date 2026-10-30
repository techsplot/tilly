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
  getNebiusModel: vi.fn(() => "answer-model"),
}));

const mockSearch = vi.hoisted(() => vi.fn());
vi.mock("../src/infrastructure/tavily/tavily-client", () => ({
  searchTavily: mockSearch,
}));

import {
  NO_GUIDANCE_REPLY,
  answerGuidance,
} from "../src/application/farm-guidance";
import { recordAgentEvent } from "../src/application/persist-farm-event";
import { createTestFarm as createFarm } from "./test-helpers";
import * as schema from "../src/infrastructure/db/schema";

const RESULTS = [
  {
    title: "Aphids on vegetables",
    url: "https://www.ipm.ucanr.edu/aphids",
    content: "Check leaf undersides; use insecticidal soap.",
  },
  {
    title: "Tomato pests",
    url: "https://fao.org/tomato",
    content: "Encourage natural predators.",
  },
];

function modelReply(answer: string, sourceIds: number[]) {
  return {
    choices: [{ message: { content: JSON.stringify({ answer, sourceIds }) } }],
  };
}

describe("farm guidance", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let farmId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  }, 180000);

  beforeEach(async () => {
    mockCreate.mockReset();
    mockSearch.mockReset();
    await db.delete(schema.eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
    farmId = await createFarm(db, "Hillside Farm");
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  async function saveTomatoSpray() {
    const { event } = await recordAgentEvent(db, farmId, {
      final: {
        activity: "spraying",
        crop: "tomatoes",
        field: "North Field",
        eventDate: "2026-10-20",
        quantity: null,
        unit: null,
        status: "confirmed",
        missingFields: [],
        sourceText: "seed",
      },
      currentDate: "2026-10-20",
    });
    return event;
  }

  it("answers with Tavily's links and the farmer's related records", async () => {
    const saved = await saveTomatoSpray();
    mockSearch.mockResolvedValueOnce(RESULTS);
    mockCreate.mockResolvedValueOnce(
      modelReply("Check under the leaves and use soap.", [1, 2]),
    );

    const result = await answerGuidance(
      db,
      farmId,
      "How do I control aphids on tomatoes?",
      { crop: "tomatoes" },
    );

    expect(result).toEqual({
      kind: "guidance",
      text: "Check under the leaves and use soap.",
      sources: [
        {
          id: 1,
          title: "Aphids on vegetables",
          url: "https://www.ipm.ucanr.edu/aphids",
          domain: "ipm.ucanr.edu",
        },
        {
          id: 2,
          title: "Tomato pests",
          url: "https://fao.org/tomato",
          domain: "fao.org",
        },
      ],
      citedRecords: [
        expect.objectContaining({ id: saved.id, crop: "tomatoes" }),
      ],
    });
  });

  it("sends only the farmer's question to Tavily, never farm data", async () => {
    await saveTomatoSpray();
    mockSearch.mockResolvedValueOnce(RESULTS);
    mockCreate.mockResolvedValueOnce(modelReply("Use soap.", [1]));

    await answerGuidance(db, farmId, "How do I control aphids?", {
      crop: "tomatoes",
    });

    expect(mockSearch).toHaveBeenCalledWith("How do I control aphids?");
    const query = String(mockSearch.mock.calls[0]![0]);
    for (const farmFact of ["Hillside", "North Field"]) {
      expect(query).not.toContain(farmFact);
    }
  });

  it("returns the fallback reply without a model call when nothing is found", async () => {
    mockSearch.mockResolvedValueOnce([]);

    const result = await answerGuidance(
      db,
      farmId,
      "Why is the sky green?",
      null,
    );

    expect(result).toEqual({ kind: "none", text: NO_GUIDANCE_REPLY });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("drops source ids the model invented", async () => {
    mockSearch.mockResolvedValueOnce(RESULTS);
    mockCreate.mockResolvedValueOnce(
      modelReply("See https://evil.example for more.", [2, 7]),
    );

    const result = await answerGuidance(db, farmId, "aphids?", null);

    expect(result.kind).toBe("guidance");
    if (result.kind !== "guidance") return;
    expect(result.sources.map((source) => source.url)).toEqual([
      "https://fao.org/tomato",
    ]);
  });

  it("returns the fallback when no cited source is real", async () => {
    mockSearch.mockResolvedValueOnce(RESULTS);
    mockCreate.mockResolvedValueOnce(modelReply("Made up.", [9]));

    const result = await answerGuidance(db, farmId, "aphids?", null);

    expect(result).toEqual({ kind: "none", text: NO_GUIDANCE_REPLY });
  });

  it("does not load records when the question names no crop or activity", async () => {
    await saveTomatoSpray();
    mockSearch.mockResolvedValueOnce(RESULTS);
    mockCreate.mockResolvedValueOnce(modelReply("General advice.", [1]));

    const result = await answerGuidance(db, farmId, "what is mulching?", {});

    expect(result.kind === "guidance" && result.citedRecords).toEqual([]);
  });

  it("rejects malformed model output", async () => {
    mockSearch.mockResolvedValueOnce(RESULTS);
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json" } }],
    });

    await expect(answerGuidance(db, farmId, "aphids?", null)).rejects.toThrow(
      /invalid guidance/,
    );
  });
});
