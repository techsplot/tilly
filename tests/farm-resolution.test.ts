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

import { handleFarmerMessage } from "../src/application/farm-agent";
import { listTimeline } from "../src/application/persist-farm-event";
import { createFarm } from "../src/infrastructure/db/farm-event-repository";
import * as schema from "../src/infrastructure/db/schema";

function weeding(farmReference: string | null) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            events: [
              {
                activity: "weeding",
                crop: "maize",
                field: "Back Field",
                eventDate: "2026-10-12",
                quantity: null,
                unit: null,
              },
            ],
            clarificationRequired: false,
            clarificationQuestion: null,
            followUpQuestion: null,
            farmReference,
          }),
        },
      },
    ],
  };
}

describe("farm resolution makes one extraction per new message", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sessionId: string;
  let homeId: string;
  let riverId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  }, 180000);

  beforeEach(async () => {
    mockCreate.mockReset();
    await db.delete(schema.eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
    sessionId = `session-${Date.now()}`;
    homeId = await createFarm(db, sessionId, "Home Plot");
    riverId = await createFarm(db, sessionId, "River Farm");
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  const send = (message: string) =>
    handleFarmerMessage(db, homeId, {
      message,
      currentDate: "2026-10-12",
      recentEventIds: [],
      sessionId,
    });

  it("calls the model once for a message that names no farm", async () => {
    mockCreate.mockResolvedValueOnce(weeding(null));
    const actions = await send("I weeded the back field today");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(actions[0]?.type).toBe("recorded");
    expect(await listTimeline(db, homeId)).toHaveLength(1);
  });

  it("calls the model once for a message that names the active farm", async () => {
    mockCreate.mockResolvedValueOnce(weeding("Home Plot"));
    await send("I weeded the back field at Home Plot today");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await listTimeline(db, homeId)).toHaveLength(1);
  });

  it("extracts again with the other farm's memory and saves there", async () => {
    mockCreate
      .mockResolvedValueOnce(weeding("River Farm"))
      .mockResolvedValueOnce(weeding("River Farm"));
    const actions = await send("I weeded the back field at River Farm today");
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(actions[0]?.type).toBe("recorded");
    expect(await listTimeline(db, riverId)).toHaveLength(1);
    expect(await listTimeline(db, homeId)).toHaveLength(0);
  });

  it("lists the farms and saves nothing when the farm is unknown", async () => {
    mockCreate.mockResolvedValueOnce(weeding("Hill Farm"));
    const actions = await send("I weeded at Hill Farm today");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(actions).toEqual([
      {
        type: "reply",
        text: 'I couldn\'t find a farm named "Hill Farm". Your farms: Home Plot, River Farm',
      },
    ]);
    expect(await listTimeline(db, homeId)).toHaveLength(0);
    expect(await listTimeline(db, riverId)).toHaveLength(0);
  });

  it("asks which farm and saves nothing when the name is ambiguous", async () => {
    await createFarm(db, sessionId, "River Farm");
    mockCreate.mockResolvedValueOnce(weeding("River Farm"));
    const actions = await send("I weeded at River Farm today");
    expect(actions[0]).toMatchObject({ type: "reply" });
    if (actions[0]?.type !== "reply") throw new Error("expected reply");
    expect(actions[0].text).toContain("Which one did you mean?");
    expect(await listTimeline(db, riverId)).toHaveLength(0);
  });

  it("treats a field the model put in farmReference as a field", async () => {
    // Live testing: "I weeded the north field" → farm "north field".
    mockCreate.mockResolvedValueOnce(weeding("Back Field"));
    const actions = await send("I weeded the back field today");
    expect(actions[0]?.type).toBe("recorded");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await listTimeline(db, homeId)).toHaveLength(1);
  });

  it("ignores farm names from other sessions", async () => {
    await createFarm(db, "someone-else", "Hill Farm");
    mockCreate.mockResolvedValueOnce(weeding("Hill Farm"));
    const actions = await send("I weeded at Hill Farm today");
    expect(actions[0]).toMatchObject({ type: "reply" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
