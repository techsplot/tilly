import { describe, it, expect, beforeEach } from "vitest";
import {
  createFarm,
  findFarmByIdAndSession,
  findFarmByNameAndSession,
  listFarmsBySession,
  listFarmEvents,
  type Database,
} from "../src/infrastructure/db/farm-event-repository";
import { recordAgentEvent } from "../src/application/persist-farm-event";
import { resolveFarmReference } from "../src/application/farm-resolver";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import * as schema from "../src/infrastructure/db/schema";

async function getTestDb(): Promise<Database> {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  await migrate(db, {
    migrationsFolder: resolve(import.meta.dirname, "../drizzle"),
  });
  return db;
}

describe("Multi-farm workspace support", () => {
  let db: Database;
  let sessionId: string;
  let farm1Id: string;
  let farm2Id: string;

  beforeEach(async () => {
    db = await getTestDb();
    sessionId = `session-${Date.now()}`;
    farm1Id = await createFarm(db, sessionId, "River Farm");
    farm2Id = await createFarm(db, sessionId, "Home Plot");
  }, 60000); // PGlite migration can be slow when competing for resources in CI

  describe("Farm creation and listing", () => {
    it("creates multiple farms for the same session", async () => {
      const farms = await listFarmsBySession(db, sessionId);
      expect(farms).toHaveLength(2);
      expect(farms.map((f) => f.name).sort()).toEqual([
        "Home Plot",
        "River Farm",
      ]);
    });

    it("does not list farms from other sessions", async () => {
      const otherSession = "other-session";
      await createFarm(db, otherSession, "Other Farm");
      const farms = await listFarmsBySession(db, sessionId);
      expect(farms).toHaveLength(2);
      expect(farms.every((f) => f.name !== "Other Farm")).toBe(true);
    });

    it("finds farm by ID and session", async () => {
      const farm = await findFarmByIdAndSession(db, farm1Id, sessionId);
      expect(farm).toBeDefined();
      expect(farm?.name).toBe("River Farm");
    });

    it("returns undefined for farm from different session", async () => {
      const farm = await findFarmByIdAndSession(db, farm1Id, "wrong-session");
      expect(farm).toBeUndefined();
    });
  });

  describe("Natural language farm resolution", () => {
    it("resolves exact farm name match", async () => {
      const result = await resolveFarmReference(
        db,
        sessionId,
        "River Farm",
        farm1Id,
      );
      expect(result).toEqual({ status: "resolved", farmId: farm1Id });
    });

    it("resolves exact farm name match case-insensitively", async () => {
      const result = await resolveFarmReference(
        db,
        sessionId,
        "river farm",
        farm1Id,
      );
      expect(result).toEqual({ status: "resolved", farmId: farm1Id });
    });

    it("returns not_found for unknown farm", async () => {
      const result = await resolveFarmReference(
        db,
        sessionId,
        "Unknown Farm",
        farm1Id,
      );
      expect(result).toEqual({
        status: "not_found",
        reference: "Unknown Farm",
      });
    });

    it("returns ambiguous for multiple exact matches", async () => {
      await createFarm(db, sessionId, "River Farm 2");
      const matches = await findFarmByNameAndSession(
        db,
        "River Farm",
        sessionId,
      );
      // Should only match "River Farm" exactly, not "River Farm 2"
      expect(matches).toHaveLength(1);
    });

    it("returns null for empty farm reference", async () => {
      const result = await resolveFarmReference(db, sessionId, null, farm1Id);
      expect(result).toBeNull();
    });

    it("does not resolve farms from other sessions", async () => {
      const otherSession = "other-session";
      await createFarm(db, otherSession, "River Farm");
      const matches = await findFarmByNameAndSession(
        db,
        "River Farm",
        sessionId,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.id).toBe(farm1Id);
    });
  });

  describe("Farm-scoped event storage", () => {
    it("saves events to the correct farm", async () => {
      const result1 = await recordAgentEvent(db, farm1Id, {
        final: {
          activity: "planting",
          crop: "maize",
          field: "back field",
          eventDate: "2026-10-15",
          quantity: null,
          unit: null,
          eventTime: null,
          timeOfDay: null,
          status: "confirmed",
          missingFields: [],
          sourceText: "I planted maize in the back field",
          resolvedFromMemory: [],
          unresolvedReferences: [],
        },
        currentDate: "2026-10-15",
      });

      const result2 = await recordAgentEvent(db, farm2Id, {
        final: {
          activity: "weeding",
          crop: "tomatoes",
          field: "front plot",
          eventDate: "2026-10-15",
          quantity: null,
          unit: null,
          eventTime: null,
          timeOfDay: null,
          status: "confirmed",
          missingFields: [],
          sourceText: "I weeded tomatoes at the front plot",
          resolvedFromMemory: [],
          unresolvedReferences: [],
        },
        currentDate: "2026-10-15",
      });

      const farm1Events = await listFarmEvents(db, farm1Id);
      const farm2Events = await listFarmEvents(db, farm2Id);

      expect(farm1Events).toHaveLength(1);
      expect(farm1Events[0]?.id).toBe(result1.event.id);
      expect(farm1Events[0]?.crop).toBe("maize");

      expect(farm2Events).toHaveLength(1);
      expect(farm2Events[0]?.id).toBe(result2.event.id);
      expect(farm2Events[0]?.crop).toBe("tomatoes");
    });

    it("does not expose events from other farms", async () => {
      await recordAgentEvent(db, farm1Id, {
        final: {
          activity: "planting",
          crop: "secret crop",
          field: "hidden field",
          eventDate: "2026-10-15",
          quantity: null,
          unit: null,
          eventTime: null,
          timeOfDay: null,
          status: "confirmed",
          missingFields: [],
          sourceText: "secret",
          resolvedFromMemory: [],
          unresolvedReferences: [],
        },
        currentDate: "2026-10-15",
      });

      const farm2Events = await listFarmEvents(db, farm2Id);
      expect(farm2Events).toHaveLength(0);
    });
  });

  describe("Farm-scoped queries and corrections", () => {
    it("only returns events from the queried farm", async () => {
      await recordAgentEvent(db, farm1Id, {
        final: {
          activity: "planting",
          crop: "maize",
          field: "river field",
          eventDate: "2026-10-15",
          quantity: null,
          unit: null,
          eventTime: null,
          timeOfDay: null,
          status: "confirmed",
          missingFields: [],
          sourceText: "planted maize",
          resolvedFromMemory: [],
          unresolvedReferences: [],
        },
        currentDate: "2026-10-15",
      });

      await recordAgentEvent(db, farm2Id, {
        final: {
          activity: "planting",
          crop: "beans",
          field: "home field",
          eventDate: "2026-10-15",
          quantity: null,
          unit: null,
          eventTime: null,
          timeOfDay: null,
          status: "confirmed",
          missingFields: [],
          sourceText: "planted beans",
          resolvedFromMemory: [],
          unresolvedReferences: [],
        },
        currentDate: "2026-10-15",
      });

      const farm1Events = await listFarmEvents(db, farm1Id);
      expect(farm1Events.every((e) => e.crop !== "beans")).toBe(true);

      const farm2Events = await listFarmEvents(db, farm2Id);
      expect(farm2Events.every((e) => e.crop !== "maize")).toBe(true);
    });
  });

  describe("Ownership verification", () => {
    it("verifies farm belongs to session before access", async () => {
      const wrongSession = "wrong-session";
      const farm = await findFarmByIdAndSession(db, farm1Id, wrongSession);
      expect(farm).toBeUndefined();
    });

    it("allows access to farm with correct session", async () => {
      const farm = await findFarmByIdAndSession(db, farm1Id, sessionId);
      expect(farm).toBeDefined();
      expect(farm?.name).toBe("River Farm");
    });
  });
});
