import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/infrastructure/db/schema";
import {
  farms,
  reminders,
  pushSubscriptions,
} from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import {
  createReminder,
  findDueReminders,
  getFarmPhoneNumber,
  isFarmerActiveInApp,
  recordFarmActivity,
  getPushSubscription,
  savePushSubscription,
  recordPushSent,
  recordTwilioSid,
  updateCarrierStatus,
  acknowledgeReminderBySmsFrom,
  findDueRemindersForFarm,
  acknowledgeReminder,
  snoozeReminder,
} from "../src/infrastructure/db/reminder-repository";
import { createTestFarm } from "./test-helpers";

const migrationFolder = "drizzle";

describe("reminder repository — delivery functions", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationFolder });
  }, 180000);

  beforeEach(async () => {
    await db.delete(pushSubscriptions);
    await db.delete(reminders);
    await db.delete(farms);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  // ─── getFarmPhoneNumber ───────────────────────────────────────────────────

  describe("getFarmPhoneNumber", () => {
    it("returns the phone number when set", async () => {
      const farmId = await createTestFarm(db, "Farm A");
      await db
        .update(farms)
        .set({ phoneNumber: "+2348012345678" })
        .where(eq(farms.id, farmId));

      const phone = await getFarmPhoneNumber(db, farmId);
      expect(phone).toBe("+2348012345678");
    });

    it("returns null when phone number is not set", async () => {
      const farmId = await createTestFarm(db, "Farm B");
      const phone = await getFarmPhoneNumber(db, farmId);
      expect(phone).toBeNull();
    });

    it("returns null for non-existent farm", async () => {
      const phone = await getFarmPhoneNumber(
        db,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(phone).toBeNull();
    });
  });

  // ─── isFarmerActiveInApp ──────────────────────────────────────────────────

  describe("isFarmerActiveInApp", () => {
    it("is true right after recordFarmActivity", async () => {
      const farmId = await createTestFarm(db, "Farm Heartbeat");
      expect(await isFarmerActiveInApp(db, farmId, 30)).toBe(false);

      await recordFarmActivity(db, farmId);

      expect(await isFarmerActiveInApp(db, farmId, 30)).toBe(true);
    });

    it("returns true when last_active_at is within the window", async () => {
      const farmId = await createTestFarm(db, "Farm Active");
      // Set last_active_at to 10 minutes ago
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      await db
        .update(farms)
        .set({ lastActiveAt: tenMinutesAgo })
        .where(eq(farms.id, farmId));

      const active = await isFarmerActiveInApp(db, farmId, 30);
      expect(active).toBe(true);
    });

    it("returns false when last_active_at is outside the window", async () => {
      const farmId = await createTestFarm(db, "Farm Inactive");
      // Set last_active_at to 45 minutes ago
      const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000);
      await db
        .update(farms)
        .set({ lastActiveAt: fortyFiveMinutesAgo })
        .where(eq(farms.id, farmId));

      const active = await isFarmerActiveInApp(db, farmId, 30);
      expect(active).toBe(false);
    });

    it("returns false when last_active_at is null", async () => {
      const farmId = await createTestFarm(db, "Farm Never Active");
      const active = await isFarmerActiveInApp(db, farmId, 30);
      expect(active).toBe(false);
    });
  });

  // ─── getPushSubscription ──────────────────────────────────────────────────

  describe("getPushSubscription", () => {
    it("returns null when no active subscription exists", async () => {
      const farmId = await createTestFarm(db, "Farm No Push");
      const sub = await getPushSubscription(db, farmId);
      expect(sub).toBeNull();
    });

    it("returns null when only inactive subscriptions exist", async () => {
      const farmId = await createTestFarm(db, "Farm Inactive Push");
      await db.insert(pushSubscriptions).values({
        farmId,
        endpoint: "https://push.example.com/sub1",
        keys: { p256dh: "key1", auth: "auth1" },
        active: false,
      });

      const sub = await getPushSubscription(db, farmId);
      expect(sub).toBeNull();
    });

    it("returns the most recent active subscription", async () => {
      const farmId = await createTestFarm(db, "Farm With Push");
      // Insert two subscriptions with different created_at
      await db.insert(pushSubscriptions).values({
        farmId,
        endpoint: "https://push.example.com/older",
        keys: { p256dh: "key-old", auth: "auth-old" },
        active: true,
        createdAt: new Date(Date.now() - 10000),
      });
      await db.insert(pushSubscriptions).values({
        farmId,
        endpoint: "https://push.example.com/newer",
        keys: { p256dh: "key-new", auth: "auth-new" },
        active: true,
        createdAt: new Date(Date.now() - 1000),
      });

      const sub = await getPushSubscription(db, farmId);
      expect(sub).not.toBeNull();
      expect(sub!.endpoint).toBe("https://push.example.com/newer");
    });
  });

  // ─── savePushSubscription ─────────────────────────────────────────────────

  describe("savePushSubscription", () => {
    it("inserts a new subscription when none exists", async () => {
      const farmId = await createTestFarm(db, "Farm Save Push");
      await savePushSubscription(db, farmId, {
        endpoint: "https://push.example.com/sub1",
        keys: { p256dh: "key1", auth: "auth1" },
        userAgent: "Chrome/100",
      });

      const sub = await getPushSubscription(db, farmId);
      expect(sub).not.toBeNull();
      expect(sub!.endpoint).toBe("https://push.example.com/sub1");
      expect(sub!.active).toBe(true);
    });

    it("updates existing subscription for same (farmId, endpoint)", async () => {
      const farmId = await createTestFarm(db, "Farm Update Push");
      const endpoint = "https://push.example.com/sub1";

      await savePushSubscription(db, farmId, {
        endpoint,
        keys: { p256dh: "key-old", auth: "auth-old" },
      });
      // Set it inactive to verify update sets it back to active
      const [existing] = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.farmId, farmId));
      await db
        .update(pushSubscriptions)
        .set({ active: false })
        .where(eq(pushSubscriptions.id, existing!.id));

      // Re-save same endpoint with new keys
      await savePushSubscription(db, farmId, {
        endpoint,
        keys: { p256dh: "key-new", auth: "auth-new" },
      });

      const allSubs = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.farmId, farmId));

      // Only one row should exist
      expect(allSubs).toHaveLength(1);
      expect(allSubs[0]!.active).toBe(true);
      expect((allSubs[0]!.keys as Record<string, string>).p256dh).toBe(
        "key-new",
      );
    });

    it("inserts different endpoints as separate rows", async () => {
      const farmId = await createTestFarm(db, "Farm Multi Push");
      await savePushSubscription(db, farmId, {
        endpoint: "https://push.example.com/sub1",
        keys: { p256dh: "key1", auth: "auth1" },
      });
      await savePushSubscription(db, farmId, {
        endpoint: "https://push.example.com/sub2",
        keys: { p256dh: "key2", auth: "auth2" },
      });

      const allSubs = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.farmId, farmId));
      expect(allSubs).toHaveLength(2);
    });
  });

  // ─── recordPushSent ───────────────────────────────────────────────────────

  describe("recordPushSent", () => {
    it("sets delivery_method=push, carrier_status=push_sent, snoozed_until ~2h from now", async () => {
      const farmId = await createTestFarm(db, "Farm Push Sent");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      const before = Date.now();
      await recordPushSent(db, reminderId);
      const after = Date.now();

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.deliveryMethod).toBe("push");
      expect(row!.carrierStatus).toBe("push_sent");
      expect(row!.carrierStatusAt).toBeInstanceOf(Date);
      expect(row!.snoozedUntil).toBeInstanceOf(Date);

      // snoozed_until should be approximately 2 hours from now
      const snoozedMs = row!.snoozedUntil!.getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      expect(snoozedMs).toBeGreaterThanOrEqual(before + twoHoursMs - 1000);
      expect(snoozedMs).toBeLessThanOrEqual(after + twoHoursMs + 1000);
    });

    it("findDueReminders excludes the reminder while snoozed", async () => {
      const farmId = await createTestFarm(db, "Farm Push Snooze");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await recordPushSent(db, reminderId);

      // Should be excluded while snoozed_until is 2h in the future
      const due = await findDueReminders(db, "2026-10-20", 10);
      expect(due.find((r) => r.id === reminderId)).toBeUndefined();
    });

    it("findDueReminders includes the reminder after snoozed_until passes", async () => {
      const farmId = await createTestFarm(db, "Farm Push Expired");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      // Manually set snoozed_until to a time in the past
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000 - 1000);
      await db
        .update(reminders)
        .set({
          deliveryMethod: "push",
          carrierStatus: "push_sent",
          snoozedUntil: twoHoursAgo,
        })
        .where(eq(reminders.id, reminderId));

      const due = await findDueReminders(db, "2026-10-20", 10);
      expect(due.find((r) => r.id === reminderId)).toBeDefined();
    });
  });

  // ─── recordTwilioSid ──────────────────────────────────────────────────────

  describe("recordTwilioSid", () => {
    it("stores the SID and sets delivery_method=sms, carrier_status=sent", async () => {
      const farmId = await createTestFarm(db, "Farm Twilio");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await recordTwilioSid(db, reminderId, "SM1234567890abcdef");

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.twilioMessageSid).toBe("SM1234567890abcdef");
      expect(row!.deliveryMethod).toBe("sms");
      expect(row!.carrierStatus).toBe("sent");
      // status must remain pending (not delivered yet)
      expect(row!.status).toBe("pending");
    });

    it("increments delivery attempts", async () => {
      const farmId = await createTestFarm(db, "Farm Twilio Attempts");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await recordTwilioSid(db, reminderId, "SM_first");
      await recordTwilioSid(db, reminderId, "SM_second");

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(Number(row!.deliveryAttempts)).toBe(2);
    });
  });

  // ─── updateCarrierStatus ──────────────────────────────────────────────────

  describe("updateCarrierStatus", () => {
    it('"delivered" sets status=delivered and carrier_status=delivered', async () => {
      const farmId = await createTestFarm(db, "Farm CS Delivered");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await updateCarrierStatus(db, reminderId, "delivered");

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.status).toBe("delivered");
      expect(row!.carrierStatus).toBe("delivered");
    });

    it('"failed" reverts status=pending and sets carrier_status=failed', async () => {
      const farmId = await createTestFarm(db, "Farm CS Failed");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });
      // First simulate it was "delivered"
      await db
        .update(reminders)
        .set({ status: "delivered" })
        .where(eq(reminders.id, reminderId));

      await updateCarrierStatus(db, reminderId, "failed");

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.status).toBe("pending");
      expect(row!.carrierStatus).toBe("failed");
    });

    it('"undelivered" reverts status=pending and sets carrier_status=undelivered', async () => {
      const farmId = await createTestFarm(db, "Farm CS Undelivered");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await updateCarrierStatus(db, reminderId, "undelivered");

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.status).toBe("pending");
      expect(row!.carrierStatus).toBe("undelivered");
    });

    it("other values only update carrier_status, leave status unchanged", async () => {
      const farmId = await createTestFarm(db, "Farm CS Sending");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await updateCarrierStatus(db, reminderId, "sending");

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.status).toBe("pending"); // unchanged
      expect(row!.carrierStatus).toBe("sending");
    });

    it("is idempotent for the same status", async () => {
      const farmId = await createTestFarm(db, "Farm CS Idempotent");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await updateCarrierStatus(db, reminderId, "delivered");
      await updateCarrierStatus(db, reminderId, "delivered");

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.status).toBe("delivered");
      expect(row!.carrierStatus).toBe("delivered");
    });
  });

  // ─── acknowledgeReminderBySmsFrom ─────────────────────────────────────────

  describe("acknowledgeReminderBySmsFrom", () => {
    it("marks the most recent unacknowledged reminder as acknowledged", async () => {
      const farmId = await createTestFarm(db, "Farm SMS Ack");
      await db
        .update(farms)
        .set({ phoneNumber: "+2348099887766" })
        .where(eq(farms.id, farmId));

      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await acknowledgeReminderBySmsFrom(db, "+2348099887766");

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.acknowledgedAt).toBeInstanceOf(Date);
      expect(row!.status).toBe("delivered");
    });

    it("does nothing when no farm has that phone number", async () => {
      // Should not throw
      await expect(
        acknowledgeReminderBySmsFrom(db, "+2340000000000"),
      ).resolves.toBeUndefined();
    });

    it("does nothing when no unacknowledged reminders exist", async () => {
      const farmId = await createTestFarm(db, "Farm No Pending");
      await db
        .update(farms)
        .set({ phoneNumber: "+2348011112222" })
        .where(eq(farms.id, farmId));

      // Should not throw
      await expect(
        acknowledgeReminderBySmsFrom(db, "+2348011112222"),
      ).resolves.toBeUndefined();
    });

    it("picks the most recent reminder when multiple exist", async () => {
      const farmId = await createTestFarm(db, "Farm Multi Remind");
      await db
        .update(farms)
        .set({ phoneNumber: "+2348033334444" })
        .where(eq(farms.id, farmId));

      await createReminder(db, farmId, {
        reminderDate: "2026-10-18",
        activity: "older-task",
        reminderKind: "manual",
      });
      const newerReminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "newer-task",
        reminderKind: "manual",
      });

      await acknowledgeReminderBySmsFrom(db, "+2348033334444");

      const [newerRow] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, newerReminderId));

      expect(newerRow!.status).toBe("delivered");
    });
  });

  // ─── findDueRemindersForFarm ──────────────────────────────────────────────

  describe("findDueRemindersForFarm", () => {
    it("returns pending reminders due on or before today for the farm", async () => {
      const farmId = await createTestFarm(db, "Farm Due Farm");

      await createReminder(db, farmId, {
        reminderDate: "2026-10-15",
        activity: "past",
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

      const due = await findDueRemindersForFarm(db, farmId, "2026-10-20");
      expect(due).toHaveLength(2);
      expect(due.map((r) => r.activity).sort()).toEqual(["past", "today"]);
    });

    it("excludes snoozed reminders", async () => {
      const farmId = await createTestFarm(db, "Farm Due Snooze");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "snoozed",
        reminderKind: "manual",
      });

      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      await snoozeReminder(db, farmId, reminderId, oneHourFromNow);

      const due = await findDueRemindersForFarm(db, farmId, "2026-10-20");
      expect(due.find((r) => r.id === reminderId)).toBeUndefined();
    });

    it("does not return reminders from other farms", async () => {
      const farm1 = await createTestFarm(db, "Farm A");
      const farm2 = await createTestFarm(db, "Farm B");

      await createReminder(db, farm2, {
        reminderDate: "2026-10-20",
        activity: "other-farm",
        reminderKind: "manual",
      });

      const due = await findDueRemindersForFarm(db, farm1, "2026-10-20");
      expect(due).toHaveLength(0);
    });
  });

  // ─── acknowledgeReminder ──────────────────────────────────────────────────

  describe("acknowledgeReminder", () => {
    it("sets acknowledged_at and status=delivered with ownership check", async () => {
      const farmId = await createTestFarm(db, "Farm Ack Banner");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      await acknowledgeReminder(db, farmId, reminderId);

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.acknowledgedAt).toBeInstanceOf(Date);
      expect(row!.status).toBe("delivered");
    });

    it("does not acknowledge another farm's reminder", async () => {
      const farm1 = await createTestFarm(db, "Farm Owner");
      const farm2 = await createTestFarm(db, "Farm Other");
      const reminderId = await createReminder(db, farm1, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      // farm2 tries to acknowledge farm1's reminder — should be a no-op
      await acknowledgeReminder(db, farm2, reminderId);

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.acknowledgedAt).toBeNull();
      expect(row!.status).toBe("pending");
    });
  });

  // ─── snoozeReminder ───────────────────────────────────────────────────────

  describe("snoozeReminder", () => {
    it("sets snoozed_until to the given date with ownership check", async () => {
      const farmId = await createTestFarm(db, "Farm Snooze");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      const snoozeUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await snoozeReminder(db, farmId, reminderId, snoozeUntil);

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.snoozedUntil).toBeInstanceOf(Date);
      // Allow 1 second tolerance for test execution time
      expect(
        Math.abs(row!.snoozedUntil!.getTime() - snoozeUntil.getTime()),
      ).toBeLessThan(1000);
      expect(row!.status).toBe("pending"); // status unchanged
    });

    it("does not snooze another farm's reminder", async () => {
      const farm1 = await createTestFarm(db, "Farm Snooze Owner");
      const farm2 = await createTestFarm(db, "Farm Snooze Other");
      const reminderId = await createReminder(db, farm1, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      const snoozeUntil = new Date(Date.now() + 60 * 60 * 1000);
      await snoozeReminder(db, farm2, reminderId, snoozeUntil);

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      expect(row!.snoozedUntil).toBeNull();
    });

    it("allows multiple snoozes", async () => {
      const farmId = await createTestFarm(db, "Farm Multi Snooze");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "weeding",
        reminderKind: "manual",
      });

      const first = new Date(Date.now() + 30 * 60 * 1000);
      await snoozeReminder(db, farmId, reminderId, first);

      const second = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await snoozeReminder(db, farmId, reminderId, second);

      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, reminderId));

      // Should reflect the second snooze
      expect(
        Math.abs(row!.snoozedUntil!.getTime() - second.getTime()),
      ).toBeLessThan(1000);
    });
  });

  // ─── findDueReminders snooze filter (updated behavior) ───────────────────

  describe("findDueReminders — snooze filter", () => {
    it("excludes reminders where snoozed_until is in the future", async () => {
      const farmId = await createTestFarm(db, "Farm FDR Snooze");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "snoozed",
        reminderKind: "manual",
      });

      const future = new Date(Date.now() + 60 * 60 * 1000);
      await snoozeReminder(db, farmId, reminderId, future);

      const due = await findDueReminders(db, "2026-10-20", 10);
      expect(due.find((r) => r.id === reminderId)).toBeUndefined();
    });

    it("includes reminders where snoozed_until is in the past", async () => {
      const farmId = await createTestFarm(db, "Farm FDR Past Snooze");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "was-snoozed",
        reminderKind: "manual",
      });

      const past = new Date(Date.now() - 60 * 60 * 1000);
      await snoozeReminder(db, farmId, reminderId, past);

      const due = await findDueReminders(db, "2026-10-20", 10);
      expect(due.find((r) => r.id === reminderId)).toBeDefined();
    });

    it("includes reminders with null snoozed_until", async () => {
      const farmId = await createTestFarm(db, "Farm FDR No Snooze");
      const reminderId = await createReminder(db, farmId, {
        reminderDate: "2026-10-20",
        activity: "normal",
        reminderKind: "manual",
      });

      const due = await findDueReminders(db, "2026-10-20", 10);
      expect(due.find((r) => r.id === reminderId)).toBeDefined();
    });
  });
});
