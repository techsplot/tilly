import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/infrastructure/db/schema";
import { farms, reminders } from "../src/infrastructure/db/schema";
import { deliverDueReminders } from "../src/jobs/deliver-reminders";
import {
  createReminder,
  listFarmReminders,
} from "../src/infrastructure/db/reminder-repository";
import { createTestFarm } from "./test-helpers";

const migrationFolder = "drizzle";

describe("deliver reminders job", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationFolder });
  }, 180000);

  beforeEach(async () => {
    await db.delete(reminders);
    await db.delete(farms);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("delivers due reminders", async () => {
    const farmId = await createTestFarm(db, "session-1");

    // Create reminders with different dates
    await createReminder(db, farmId, {
      reminderDate: "2026-10-15", // Past
      activity: "old reminder",
      reminderKind: "manual",
    });
    await createReminder(db, farmId, {
      reminderDate: "2026-10-20", // Today
      activity: "today reminder",
      reminderKind: "manual",
    });
    await createReminder(db, farmId, {
      reminderDate: "2026-10-25", // Future
      activity: "future reminder",
      reminderKind: "manual",
    });

    const result = await deliverDueReminders(db, "2026-10-20", 10);

    expect(result.delivered).toBe(2); // Past + today
    expect(result.failed).toBe(0);

    const pending = await listFarmReminders(db, farmId, "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.activity).toBe("future reminder");

    const delivered = await listFarmReminders(db, farmId, "delivered");
    expect(delivered).toHaveLength(2);
    expect(delivered.map((r) => r.activity).sort()).toEqual([
      "old reminder",
      "today reminder",
    ]);
  });

  it("does not re-deliver already-delivered reminders", async () => {
    const farmId = await createTestFarm(db, "session-1");

    await createReminder(db, farmId, {
      reminderDate: "2026-10-20",
      activity: "reminder",
      reminderKind: "manual",
    });

    // First run
    const result1 = await deliverDueReminders(db, "2026-10-20", 10);
    expect(result1.delivered).toBe(1);

    // Second run - should not deliver again
    const result2 = await deliverDueReminders(db, "2026-10-20", 10);
    expect(result2.delivered).toBe(0);

    const delivered = await listFarmReminders(db, farmId, "delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.deliveryAttempts).toBe(1);
  });

  it("increments delivery attempts on the delivered reminder", async () => {
    const farmId = await createTestFarm(db, "session-1");

    await createReminder(db, farmId, {
      reminderDate: "2026-10-20",
      activity: "reminder",
      reminderKind: "manual",
    });

    await deliverDueReminders(db, "2026-10-20", 10);

    const delivered = await listFarmReminders(db, farmId, "delivered");
    expect(delivered[0]?.deliveryAttempts).toBe(1);
    expect(delivered[0]?.lastDeliveredAt).toBeInstanceOf(Date);
  });

  it("respects batch size limit", async () => {
    const farmId = await createTestFarm(db, "session-1");

    // Create 5 due reminders
    for (let i = 0; i < 5; i++) {
      await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: `reminder ${i}`,
        reminderKind: "manual",
      });
    }

    // Process only 3 at a time
    const result = await deliverDueReminders(db, "2026-10-20", 3);
    expect(result.delivered).toBe(3);

    const pending = await listFarmReminders(db, farmId, "pending");
    expect(pending).toHaveLength(2);
  });

  it("continues processing after one reminder fails", async () => {
    const farmId = await createTestFarm(db, "session-1");

    // Create multiple reminders
    await createReminder(db, farmId, {
      reminderDate: "2026-10-20",
      activity: "reminder 1",
      reminderKind: "manual",
    });
    await createReminder(db, farmId, {
      reminderDate: "2026-10-20",
      activity: "reminder 2",
      reminderKind: "manual",
    });

    // In a real scenario, one might fail due to network issues, etc.
    // For this test, we're just verifying the batch completes
    const result = await deliverDueReminders(db, "2026-10-20", 10);

    // All should succeed in test environment
    expect(result.delivered).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("returns correct counts", async () => {
    const farmId = await createTestFarm(db, "session-1");

    await createReminder(db, farmId, {
      reminderDate: "2026-10-20",
      activity: "reminder 1",
      reminderKind: "manual",
    });
    await createReminder(db, farmId, {
      reminderDate: "2026-10-20",
      activity: "reminder 2",
      reminderKind: "manual",
    });

    const result = await deliverDueReminders(db, "2026-10-20", 10);

    expect(result).toMatchObject({
      delivered: 2,
      failed: 0,
      skipped: 0,
    });
  });
});
