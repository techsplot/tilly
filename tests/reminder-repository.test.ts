import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/infrastructure/db/schema";
import { farms, farmEvents, reminders } from "../src/infrastructure/db/schema";
import {
  createReminder,
  listFarmReminders,
  findDueReminders,
  markDelivered,
  markDeliveryFailed,
  cancelReminder,
  generateGapReminders,
} from "../src/infrastructure/db/reminder-repository";
import { createTestFarm } from "./test-helpers";

const migrationFolder = "drizzle";

describe("reminder repository", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationFolder });
  }, 180000);

  beforeEach(async () => {
    await db.delete(reminders);
    await db.delete(farmEvents);
    await db.delete(farms);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  describe("createReminder", () => {
    it("creates a manual reminder", async () => {
      const farmId = await createTestFarm(db, "session-1");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        fieldName: "North Field",
        crop: "maize",
        message: "Don't forget!",
        reminderKind: "manual",
      });

      expect(reminderId).toBeTruthy();

      const [reminder] = await listFarmReminders(db, farmId);
      expect(reminder).toMatchObject({
        farmId,
        reminderDate: "2026-10-20",
        activity: "weeding",
        fieldName: "North Field",
        crop: "maize",
        message: "Don't forget!",
        status: "pending",
        reminderKind: "manual",
        deliveryAttempts: 0,
      });
    });

    it("is idempotent for same source_event_id and reminder_kind", async () => {
      const farmId = await createTestFarm(db, "session-1");
      const [event] = await db
        .insert(farmEvents)
        .values({
          farmId,
          activity: "weeding",
          fieldName: "North Field",
          status: "confirmed",
          missingFields: ["crop"],
          sourceText: "I weeded",
          savedBy: "agent",
        })
        .returning({ id: farmEvents.id });

      const id1 = await createReminder(db, farmId, {
        sourceEventId: event!.id,
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "gap",
      });

      const id2 = await createReminder(db, farmId, {
        sourceEventId: event!.id,
        reminderDate: "2026-10-21", // Different date
        activity: "fertilizing", // Different activity
        reminderKind: "gap", // Same kind
      });

      // Should return same id (conflict on unique constraint)
      expect(id1).toBe(id2);

      const allReminders = await listFarmReminders(db, farmId);
      expect(allReminders).toHaveLength(1);
    });

    it("allows different reminder_kind for same source_event_id", async () => {
      const farmId = await createTestFarm(db, "session-1");
      const [event] = await db
        .insert(farmEvents)
        .values({
          farmId,
          activity: "weeding",
          status: "confirmed",
          missingFields: [],
          sourceText: "I weeded",
          savedBy: "agent",
        })
        .returning({ id: farmEvents.id });

      const gapId = await createReminder(db, farmId, {
        sourceEventId: event!.id,
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "gap",
      });

      const suggestedId = await createReminder(db, farmId, {
        sourceEventId: event!.id,
        reminderDate: "2026-10-25",
        activity: "weeding",
        reminderKind: "suggested",
      });

      expect(gapId).not.toBe(suggestedId);

      const allReminders = await listFarmReminders(db, farmId);
      expect(allReminders).toHaveLength(2);
    });
  });

  describe("listFarmReminders", () => {
    it("lists reminders sorted by date", async () => {
      const farmId = await createTestFarm(db, "session-1");

      await createReminder(db, farmId, {
        reminderDate: "2026-10-25",
        activity: "fertilizing",
        reminderKind: "manual",
      });
      await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });
      await createReminder(db, farmId, {
        reminderDate: "2026-10-22",
        activity: "spraying",
        reminderKind: "manual",
      });

      const list = await listFarmReminders(db, farmId);
      expect(list.map((r) => r.reminderDate)).toEqual([
        "2026-10-20",
        "2026-10-22",
        "2026-10-25",
      ]);
    });

    it("filters by status", async () => {
      const farmId = await createTestFarm(db, "session-1");

      const id1 = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });
      await createReminder(db, farmId, {
        reminderDate: "2026-10-21",
        activity: "spraying",
        reminderKind: "manual",
      });

      await markDelivered(db, id1);

      const pending = await listFarmReminders(db, farmId, "pending");
      expect(pending).toHaveLength(1);
      expect(pending[0]!.activity).toBe("spraying");

      const delivered = await listFarmReminders(db, farmId, "delivered");
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.activity).toBe("weeding");
    });

    it("does not return reminders from other farms", async () => {
      const farm1 = await createTestFarm(db, "session-1");
      const farm2 = await createTestFarm(db, "session-2");

      await createReminder(db, farm1, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });
      await createReminder(db, farm2, {
        reminderDate: "2026-10-20",
        activity: "spraying",
        reminderKind: "manual",
      });

      const farm1Reminders = await listFarmReminders(db, farm1);
      expect(farm1Reminders).toHaveLength(1);
      expect(farm1Reminders[0]!.activity).toBe("weeding");
    });
  });

  describe("findDueReminders", () => {
    it("returns pending reminders due today or earlier", async () => {
      const farmId = await createTestFarm(db, "session-1");

      await createReminder(db, farmId, {
        reminderDate: "2026-10-15",
        activity: "old",
        reminderKind: "manual",
      });
      await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "today",
        reminderKind: "manual",
      });
      await createReminder(db, farmId, {
        reminderDate: "2026-10-25",
        activity: "future",
        reminderKind: "manual",
      });

      const due = await findDueReminders(db, "2026-10-20", 10);
      expect(due).toHaveLength(2);
      expect(due.map((r) => r.activity).sort()).toEqual(["old", "today"]);
    });

    it("does not return delivered or cancelled reminders", async () => {
      const farmId = await createTestFarm(db, "session-1");

      const id1 = await createReminder(db, farmId, {
        reminderDate: "2026-10-15",
        activity: "delivered",
        reminderKind: "manual",
      });
      const id2 = await createReminder(db, farmId, {
        reminderDate: "2026-10-16",
        activity: "cancelled",
        reminderKind: "manual",
      });
      await createReminder(db, farmId, {
        reminderDate: "2026-10-17",
        activity: "pending",
        reminderKind: "manual",
      });

      await markDelivered(db, id1);
      await cancelReminder(db, farmId, id2);

      const due = await findDueReminders(db, "2026-10-20", 10);
      expect(due).toHaveLength(1);
      expect(due[0]!.activity).toBe("pending");
    });

    it("respects limit", async () => {
      const farmId = await createTestFarm(db, "session-1");

      for (let i = 0; i < 5; i++) {
        await createReminder(db, farmId, {
          reminderDate: "2026-10-20",
          activity: `reminder-${i}`,
          reminderKind: "manual",
        });
      }

      const due = await findDueReminders(db, "2026-10-20", 3);
      expect(due).toHaveLength(3);
    });
  });

  describe("markDelivered", () => {
    it("updates status and increments delivery attempts", async () => {
      const farmId = await createTestFarm(db, "session-1");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await markDelivered(db, reminderId);

      const [reminder] = await listFarmReminders(db, farmId);
      expect(reminder).toMatchObject({
        status: "delivered",
        deliveryAttempts: 1,
      });
      expect(reminder!.lastDeliveredAt).toBeInstanceOf(Date);
    });
  });

  describe("markDeliveryFailed", () => {
    it("increments attempts but keeps status pending", async () => {
      const farmId = await createTestFarm(db, "session-1");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await markDeliveryFailed(db, reminderId);

      const [reminder] = await listFarmReminders(db, farmId, "pending");
      expect(reminder).toMatchObject({
        status: "pending",
        deliveryAttempts: 1,
      });
    });
  });

  describe("cancelReminder", () => {
    it("cancels a reminder with ownership check", async () => {
      const farmId = await createTestFarm(db, "session-1");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      const cancelled = await cancelReminder(db, farmId, reminderId);
      expect(cancelled).toBe(true);

      const [reminder] = await listFarmReminders(db, farmId);
      expect(reminder!.status).toBe("cancelled");
    });

    it("returns false for another farm's reminder", async () => {
      const farm1 = await createTestFarm(db, "session-1");
      const farm2 = await createTestFarm(db, "session-2");

      const reminderId = await createReminder(db, farm1, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      const cancelled = await cancelReminder(db, farm2, reminderId);
      expect(cancelled).toBe(false);

      const [reminder] = await listFarmReminders(db, farm1);
      expect(reminder!.status).toBe("pending");
    });
  });

  describe("generateGapReminders", () => {
    it("creates gap reminders for confirmed events with missing fields", async () => {
      const farmId = await createTestFarm(db, "session-1");

      // Create event with gap, 2 days ago
      const twoDaysAgo = new Date("2026-10-18T10:00:00Z");
      const [event] = await db
        .insert(farmEvents)
        .values({
          farmId,
          activity: "weeding",
          fieldName: null,
          status: "confirmed",
          missingFields: ["field"],
          sourceText: "I weeded",
          savedBy: "agent",
          createdAt: twoDaysAgo,
        })
        .returning({ id: farmEvents.id });

      const created = await generateGapReminders(db, farmId, "2026-10-20");
      expect(created).toBe(1);

      const gapReminders = await listFarmReminders(db, farmId);
      expect(gapReminders).toHaveLength(1);
      expect(gapReminders[0]).toMatchObject({
        sourceEventId: event!.id,
        reminderKind: "gap",
        activity: "weeding",
        status: "pending",
      });
    });

    it("does not create gap reminders for events less than 1 day old", async () => {
      const farmId = await createTestFarm(db, "session-1");

      await db.insert(farmEvents).values({
        farmId,
        activity: "weeding",
        status: "confirmed",
        missingFields: ["field"],
        sourceText: "I weeded",
        savedBy: "agent",
        createdAt: new Date("2026-10-20T10:00:00Z"),
      });

      const created = await generateGapReminders(db, farmId, "2026-10-20");
      expect(created).toBe(0);
    });

    it("does not create gap reminders for incomplete/rejected events", async () => {
      const farmId = await createTestFarm(db, "session-1");
      const twoDaysAgo = new Date("2026-10-18T10:00:00Z");

      await db.insert(farmEvents).values({
        farmId,
        activity: "weeding",
        status: "incomplete",
        missingFields: ["field"],
        sourceText: "I weeded",
        savedBy: "farmer",
        createdAt: twoDaysAgo,
      });

      const created = await generateGapReminders(db, farmId, "2026-10-20");
      expect(created).toBe(0);
    });

    it("is idempotent - does not duplicate gap reminders", async () => {
      const farmId = await createTestFarm(db, "session-1");
      const twoDaysAgo = new Date("2026-10-18T10:00:00Z");

      await db.insert(farmEvents).values({
        farmId,
        activity: "weeding",
        status: "confirmed",
        missingFields: ["field"],
        sourceText: "I weeded",
        savedBy: "agent",
        createdAt: twoDaysAgo,
      });

      const created1 = await generateGapReminders(db, farmId, "2026-10-20");
      const created2 = await generateGapReminders(db, farmId, "2026-10-20");

      expect(created1).toBe(1);
      expect(created2).toBe(0); // Already exists

      const gapReminders = await listFarmReminders(db, farmId);
      expect(gapReminders).toHaveLength(1);
    });
  });
});
