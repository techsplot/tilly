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
import {
  confirmRecordedEvent,
  correctRecordedEvent,
  listTimeline,
  recordFarmEvent,
  rejectRecordedEvent,
} from "../src/application/persist-farm-event";
import * as schema from "../src/infrastructure/db/schema";
import {
  farms,
  fields,
  eventCorrections,
} from "../src/infrastructure/db/schema";
import { createFarm } from "../src/infrastructure/db/farm-event-repository";
import * as repository from "../src/infrastructure/db/farm-event-repository";

const migrationFolder = "drizzle";

function event(
  overrides: Partial<{
    crop: string | null;
    field: string | null;
    eventDate: string | null;
    quantity: number | null;
    unit: string | null;
    status: "proposed" | "incomplete" | "confirmed" | "corrected" | "rejected";
    missingFields: string[];
  }> = {},
) {
  return {
    activity: "planting" as const,
    crop: "maize",
    field: "Back Field",
    eventDate: "2026-10-10",
    quantity: 5,
    unit: "bags",
    status: "proposed" as const,
    missingFields: [] as string[],
    sourceText: "I planted maize.",
    ...overrides,
  };
}

describe("farm event persistence", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationFolder });
  }, 180000);

  beforeEach(async () => {
    await db.delete(eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(fields);
    await db.delete(farms);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("saves confirm, reject, and incomplete decisions with the right status", async () => {
    const farmId = await createFarm(db);
    const proposal = event();
    const confirmed = await recordFarmEvent(db, farmId, {
      proposal,
      final: proposal,
      decision: "confirm",
    });
    const incomplete = event({
      crop: null,
      field: null,
      eventDate: null,
      status: "incomplete",
      missingFields: ["crop", "field", "eventDate"],
    });
    const savedLater = await recordFarmEvent(db, farmId, {
      proposal: incomplete,
      final: incomplete,
      decision: "save_incomplete",
    });
    const rejected = await recordFarmEvent(db, farmId, {
      proposal,
      final: proposal,
      decision: "reject",
    });

    expect(confirmed.status).toBe("confirmed");
    expect(savedLater.status).toBe("incomplete");
    expect(rejected.status).toBe("rejected");
  });

  it("recomputes status and refuses a client-confirmed incomplete event", async () => {
    const farmId = await createFarm(db);
    const incomplete = event({
      crop: null,
      field: null,
      eventDate: null,
      status: "confirmed",
      missingFields: [],
    });

    await expect(
      recordFarmEvent(db, farmId, {
        proposal: incomplete,
        final: incomplete,
        decision: "confirm",
      }),
    ).rejects.toThrow("confirmEvent: event has missing fields");
    expect(await listTimeline(db, farmId)).toEqual([]);
  });

  it("records one correction containing only changed fields", async () => {
    const farmId = await createFarm(db);
    const proposal = event();
    const final = event({ field: " North   Field " });
    const saved = await recordFarmEvent(db, farmId, {
      proposal,
      final,
      decision: "confirm",
    });

    const corrections = await db.select().from(eventCorrections);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.eventId).toBe(saved.id);
    expect(corrections[0]?.before).toEqual({ field: "Back Field" });
    expect(corrections[0]?.after).toEqual({ field: "North   Field" });
  });

  it("keeps a completed saved event proposed until confirmation", async () => {
    const farmId = await createFarm(db);
    const incomplete = event({
      field: null,
      eventDate: null,
      status: "incomplete",
      missingFields: ["field", "eventDate"],
    });
    const saved = await recordFarmEvent(db, farmId, {
      proposal: incomplete,
      final: incomplete,
      decision: "save_incomplete",
    });
    const completed = await correctRecordedEvent(db, farmId, saved.id, {
      field: "Back Field",
      eventDate: "2026-10-10",
    });

    expect(completed.status).toBe("proposed");
    expect((await listTimeline(db, farmId))[0]?.status).toBe("proposed");
    expect((await confirmRecordedEvent(db, farmId, saved.id)).status).toBe(
      "confirmed",
    );
  });

  it("reuses fields by normalized name", async () => {
    const farmId = await createFarm(db);
    await recordFarmEvent(db, farmId, {
      proposal: event(),
      final: event(),
      decision: "confirm",
    });
    await recordFarmEvent(db, farmId, {
      proposal: event({ field: " back field " }),
      final: event({ field: " back field " }),
      decision: "confirm",
    });
    const savedFields = await db.select().from(fields);
    expect(savedFields).toHaveLength(1);
  });

  it("orders dated events newest first and undated events last", async () => {
    const farmId = await createFarm(db);
    await recordFarmEvent(db, farmId, {
      proposal: event({
        eventDate: null,
        missingFields: ["eventDate"],
        status: "incomplete",
      }),
      final: event({
        eventDate: null,
        missingFields: ["eventDate"],
        status: "incomplete",
      }),
      decision: "save_incomplete",
    });
    await recordFarmEvent(db, farmId, {
      proposal: event({ eventDate: "2026-10-12" }),
      final: event({ eventDate: "2026-10-12" }),
      decision: "confirm",
    });
    await recordFarmEvent(db, farmId, {
      proposal: event({ eventDate: "2026-10-11" }),
      final: event({ eventDate: "2026-10-11" }),
      decision: "confirm",
    });
    const timeline = await listTimeline(db, farmId);
    expect(timeline.map((item) => item.eventDate)).toEqual([
      "2026-10-12",
      "2026-10-11",
      null,
    ]);
  });

  it("isolates farms for listing and transitions", async () => {
    const farmA = await createFarm(db);
    const farmB = await createFarm(db);
    const saved = await recordFarmEvent(db, farmA, {
      proposal: event(),
      final: event(),
      decision: "confirm",
    });
    expect(await listTimeline(db, farmB)).toEqual([]);
    await expect(confirmRecordedEvent(db, farmB, saved.id)).rejects.toThrow(
      "Farm event was not found.",
    );
    await expect(rejectRecordedEvent(db, farmB, saved.id)).rejects.toThrow(
      "Farm event was not found.",
    );
    await expect(
      correctRecordedEvent(db, farmB, saved.id, { crop: "rice" }),
    ).rejects.toThrow("Farm event was not found.");
  });

  it("rolls back the event when a later transaction step fails", async () => {
    const farmId = await createFarm(db);
    const proposal = event();
    const insertCorrection = vi
      .spyOn(repository, "insertCorrection")
      .mockRejectedValueOnce(new Error("correction failed"));
    await expect(
      recordFarmEvent(db, farmId, {
        proposal,
        final: event({ crop: "rice" }),
        decision: "confirm",
      }),
    ).rejects.toThrow("correction failed");
    expect(insertCorrection).toHaveBeenCalledOnce();
    expect(await listTimeline(db, farmId)).toEqual([]);
    expect(await db.select().from(fields)).toEqual([]);
    vi.restoreAllMocks();
  });
});
