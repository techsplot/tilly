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
  getNebiusModel: vi.fn(() => "test-model"),
}));

const mockAnswerGuidance = vi.hoisted(() => vi.fn());
vi.mock("../src/application/farm-guidance", () => ({
  answerGuidance: mockAnswerGuidance,
}));

const mockIsConfigured = vi.hoisted(() => vi.fn());
vi.mock("../src/infrastructure/tavily/tavily-client", async (original) => ({
  ...(await original<
    typeof import("../src/infrastructure/tavily/tavily-client")
  >()),
  isTavilyConfigured: mockIsConfigured,
}));

import { handleFarmerMessage } from "../src/application/farm-agent";
import { TavilyUnavailableError } from "../src/infrastructure/tavily/tavily-client";
import * as schema from "../src/infrastructure/db/schema";
import { createTestFarm as createFarm } from "./test-helpers";

const QUESTION = "How do I control aphids on tomatoes?";

function helpResponse() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            intent: "help",
            events: [],
            clarificationRequired: false,
            clarificationQuestion: null,
            filter: { crop: "tomatoes" },
          }),
        },
      },
    ],
  };
}

describe("farm agent: general farming questions", () => {
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
    mockAnswerGuidance.mockReset();
    mockIsConfigured.mockReset();
    mockCreate.mockResolvedValue(helpResponse());
    await db.delete(schema.farmEvents);
    await db.delete(schema.farms);
    farmId = await createFarm(db);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  const ask = () =>
    handleFarmerMessage(db, farmId, {
      message: QUESTION,
      currentDate: "2026-10-30",
      recentEventIds: [],
    });

  it("keeps the fixed reply when Tavily is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const actions = await ask();

    expect(actions).toEqual([
      { type: "reply", text: expect.stringContaining("extension services") },
    ]);
    expect(mockAnswerGuidance).not.toHaveBeenCalled();
  });

  it("returns cited guidance with the extracted crop filter", async () => {
    mockIsConfigured.mockReturnValue(true);
    const sources = [
      { id: 1, title: "Aphids", url: "https://fao.org/a", domain: "fao.org" },
    ];
    mockAnswerGuidance.mockResolvedValue({
      kind: "guidance",
      text: "Check under the leaves.",
      sources,
      citedRecords: [],
    });

    const actions = await ask();

    expect(actions).toEqual([
      {
        type: "guidance",
        text: "Check under the leaves.",
        sources,
        citedRecords: [],
      },
    ]);
    expect(mockAnswerGuidance).toHaveBeenCalledWith(
      db,
      farmId,
      QUESTION,
      expect.objectContaining({ crop: "tomatoes" }),
    );
  });

  it("passes the no-result reply through", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockAnswerGuidance.mockResolvedValue({ kind: "none", text: "Nothing." });

    expect(await ask()).toEqual([{ type: "reply", text: "Nothing." }]);
  });

  it("says it can't look it up when Tavily is unavailable", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockAnswerGuidance.mockRejectedValue(new TavilyUnavailableError());

    expect(await ask()).toEqual([
      { type: "reply", text: expect.stringContaining("can't look that up") },
    ]);
  });
});
