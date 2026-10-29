import { PGlite } from "@electric-sql/pglite";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../src/infrastructure/db/schema";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => holder.db),
}));
vi.mock("../src/infrastructure/nebius/nebius-client", () => ({
  createNebiusClient: vi.fn(() => {
    throw new Error("the sample farm must not call a model");
  }),
}));

import { POST } from "../app/api/farms/sample/route";
import { openSampleFarm } from "../src/application/sample-farm";
import {
  SAMPLE_FARM_NAME,
  SAMPLE_RECORDS,
} from "../src/application/sample-farm-data";
import {
  aggregateReport,
  listFarmEvents,
  listFarmsBySession,
  queryEvents,
  type Database,
} from "../src/infrastructure/db/farm-event-repository";
import { createNebiusClient } from "../src/infrastructure/nebius/nebius-client";

const TODAY = "2026-10-19";

function daysBefore(days: number): string {
  const date = new Date(`${TODAY}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

describe("sample farm", () => {
  let client: PGlite;
  let db: Database;

  beforeAll(async () => {
    client = new PGlite();
    const pglite = drizzle(client, { schema });
    await migrate(pglite, {
      migrationsFolder: resolve(import.meta.dirname, "../drizzle"),
    });
    db = pglite;
    holder.db = db;
  }, 180000);

  beforeEach(async () => {
    await db.delete(schema.eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("creates about 15 farmer records over the past three weeks", async () => {
    const result = await openSampleFarm(db, "session-a", TODAY);
    expect(result).toMatchObject({ name: SAMPLE_FARM_NAME, created: true });

    const events = await listFarmEvents(db, result.farmId);
    expect(events).toHaveLength(SAMPLE_RECORDS.length);
    expect(events.length).toBeGreaterThanOrEqual(12);
    expect(events.every((event) => event.savedBy === "farmer")).toBe(true);

    const dates = events.map((event) => event.eventDate!).sort();
    expect(dates[0]).toBe(daysBefore(20));
    expect(dates.at(-1)).toBe(daysBefore(1));

    const activities = new Set(events.map((event) => event.activity));
    for (const activity of [
      "planting",
      "weeding",
      "spraying",
      "fertilizing",
      "harvesting",
    ]) {
      expect(activities).toContain(activity);
    }
    expect(new Set(events.map((event) => event.fieldName)).size).toBe(4); // three fields and the gap
    expect(
      new Set(events.map((event) => event.crop).filter(Boolean)).size,
    ).toBe(3);
    expect(createNebiusClient).not.toHaveBeenCalled();
  });

  it("includes one record with a gap and one corrected record", async () => {
    const { farmId } = await openSampleFarm(db, "session-a", TODAY);
    const events = await listFarmEvents(db, farmId);

    const gaps = events.filter((event) => event.status === "incomplete");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ activity: "spraying", fieldName: null });
    expect(gaps[0]!.missingFields).toEqual(["field"]);

    const corrected = events.filter((event) => event.status === "corrected");
    expect(corrected).toHaveLength(1);
    expect(corrected[0]).toMatchObject({
      activity: "spraying",
      fieldName: "Back Garden",
    });
    const corrections = await db
      .select()
      .from(schema.eventCorrections)
      .where(
        inArray(
          schema.eventCorrections.eventId,
          events.map((event) => event.id),
        ),
      );
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      eventId: corrected[0]!.id,
      before: { field: "North Field" },
      after: { field: "Back Garden" },
    });
  });

  it("gives questions and reports something to answer from", async () => {
    const { farmId } = await openSampleFarm(db, "session-a", TODAY);
    const sprays = await queryEvents(db, farmId, { activity: "spraying" });
    expect(sprays[0]?.eventDate).toBe(daysBefore(1));
    const week = await aggregateReport(db, farmId, {
      reportType: "summary",
      dateFrom: daysBefore(6),
      dateTo: TODAY,
    });
    expect(week.total).toBeGreaterThan(0);
  });

  it("is idempotent per session", async () => {
    const first = await openSampleFarm(db, "session-a", TODAY);
    const second = await openSampleFarm(db, "session-a", TODAY);
    expect(second).toEqual({
      farmId: first.farmId,
      name: SAMPLE_FARM_NAME,
      created: false,
    });
    expect(await listFarmsBySession(db, "session-a")).toHaveLength(1);
    expect(await listFarmEvents(db, first.farmId)).toHaveLength(
      SAMPLE_RECORDS.length,
    );

    const other = await openSampleFarm(db, "session-b", TODAY);
    expect(other.created).toBe(true);
    expect(other.farmId).not.toBe(first.farmId);
  });

  describe("POST /api/farms/sample", () => {
    const SESSION = "d".repeat(64);
    const request = () =>
      new Request("http://localhost/api/farms/sample", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `fieldledger_session=${SESSION}`,
        },
        body: JSON.stringify({
          currentDate: new Date().toISOString().slice(0, 10),
        }),
      });

    it("creates the farm once, then switches to it", async () => {
      const created = await POST(request());
      expect(created.status).toBe(201);
      const body = (await created.json()) as { id: string };
      expect(created.headers.get("Set-Cookie")).toContain(
        `fieldledger_farm=${body.id}`,
      );

      const again = await POST(request());
      expect(again.status).toBe(200);
      await expect(again.json()).resolves.toMatchObject({
        id: body.id,
        created: false,
      });
      const farms = await db
        .select()
        .from(schema.farms)
        .where(eq(schema.farms.sessionId, SESSION));
      // getFarmContext gives a new session its default farm first.
      expect(farms.map((farm) => farm.name).sort()).toEqual([
        "My Farm",
        SAMPLE_FARM_NAME,
      ]);
    });

    it("rejects a date far from today", async () => {
      const response = await POST(
        new Request("http://localhost/api/farms/sample", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentDate: "2020-01-01" }),
        }),
      );
      expect(response.status).toBe(400);
    });
  });
});
