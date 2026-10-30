import { and, eq, lte, isNull, or, sql, inArray, desc } from "drizzle-orm";
import type { Database } from "./farm-event-repository";
import {
  reminders,
  farmEvents,
  farms,
  pushSubscriptions,
  type ReminderRow,
  type PushSubscriptionRow,
} from "./schema";
import type { Reminder, ReminderStatus } from "../../domain/reminder";

export function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    farmId: row.farmId,
    sourceEventId: row.sourceEventId,
    reminderDate: row.reminderDate,
    activity: row.activity,
    fieldName: row.fieldName,
    crop: row.crop,
    message: row.message,
    status: row.status,
    reminderKind: row.reminderKind,
    deliveryAttempts: Number(row.deliveryAttempts),
    lastDeliveredAt: row.lastDeliveredAt,
    acknowledgedAt: row.acknowledgedAt,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Create a reminder. For reminders with source_event_id,
 * this is idempotent via unique index on (source_event_id, reminder_kind).
 * On conflict, returns the existing reminder ID.
 */
export async function createReminder(
  db: Database,
  farmId: string,
  reminder: {
    sourceEventId?: string | null;
    reminderDate: string;
    activity: string;
    fieldName?: string | null;
    crop?: string | null;
    message?: string | null;
    reminderKind: "manual" | "gap" | "suggested";
  },
): Promise<string> {
  try {
    const [result] = await db
      .insert(reminders)
      .values({
        farmId,
        sourceEventId: reminder.sourceEventId ?? null,
        reminderDate: reminder.reminderDate,
        activity: reminder.activity,
        fieldName: reminder.fieldName ?? null,
        crop: reminder.crop ?? null,
        message: reminder.message ?? null,
        reminderKind: reminder.reminderKind,
      })
      .returning({ id: reminders.id });

    if (!result) {
      throw new Error("Reminder creation failed");
    }

    return result.id;
  } catch (error: unknown) {
    // Check for unique constraint violation (code 23505 or constraint name)
    // PGlite/Drizzle may wrap the error, check multiple paths
    const err = error as {
      code?: string;
      constraint?: string;
      message?: string;
      cause?: { code?: string; constraint?: string };
    };
    const errorCode = err?.code || err?.cause?.code;
    const constraint = err?.constraint || err?.cause?.constraint;
    const isUniqueViolation =
      errorCode === "23505" ||
      constraint === "reminders_source_event_kind_idx" ||
      err?.message?.includes("reminders_source_event_kind_idx");

    if (isUniqueViolation && reminder.sourceEventId) {
      // Find and return the existing reminder
      const [existing] = await db
        .select({ id: reminders.id })
        .from(reminders)
        .where(
          and(
            eq(reminders.sourceEventId, reminder.sourceEventId),
            eq(reminders.reminderKind, reminder.reminderKind),
          ),
        )
        .limit(1);

      if (existing) {
        return existing.id;
      }
    }

    // Re-throw if it's not a duplicate or we couldn't find the existing one
    throw error;
  }
}

/**
 * List reminders for a farm, optionally filtered by status.
 * Sorted by reminder date ascending (soonest first).
 */
export async function listFarmReminders(
  db: Database,
  farmId: string,
  status?: ReminderStatus,
): Promise<Reminder[]> {
  const conditions = [eq(reminders.farmId, farmId)];
  if (status) {
    conditions.push(eq(reminders.status, status));
  }

  const rows = await db
    .select()
    .from(reminders)
    .where(and(...conditions))
    .orderBy(reminders.reminderDate, reminders.createdAt);

  return rows.map(toReminder);
}

/**
 * Find due reminders (pending, reminder_date <= currentDate, not snoozed).
 * Uses FOR UPDATE SKIP LOCKED to safely claim reminders for processing.
 * Returns up to `limit` reminders.
 * Excludes snoozed reminders (snoozedUntil > now) — this covers both
 * farmer-requested snoozes AND the 2-hour push escalation wait window.
 */
export async function findDueReminders(
  db: Database,
  currentDate: string,
  limit: number,
): Promise<Reminder[]> {
  const rows = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.status, "pending"),
        lte(reminders.reminderDate, currentDate),
        or(
          isNull(reminders.snoozedUntil),
          lte(reminders.snoozedUntil, new Date()),
        ),
      ),
    )
    .orderBy(reminders.reminderDate)
    .limit(limit)
    .for("update", { skipLocked: true });

  return rows.map(toReminder);
}

/**
 * Mark a reminder as delivered.
 * Increments delivery attempts and updates timestamp.
 */
export async function markDelivered(
  db: Database,
  reminderId: string,
): Promise<void> {
  await db
    .update(reminders)
    .set({
      status: "delivered",
      deliveryAttempts: sql`${reminders.deliveryAttempts} + 1`,
      lastDeliveredAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(reminders.id, reminderId));
}

/**
 * Mark a reminder delivery attempt as failed.
 * Increments attempts but keeps status as pending for retry.
 */
export async function markDeliveryFailed(
  db: Database,
  reminderId: string,
): Promise<void> {
  await db
    .update(reminders)
    .set({
      deliveryAttempts: sql`${reminders.deliveryAttempts} + 1`,
      lastDeliveredAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(reminders.id, reminderId));
}

/**
 * Cancel a reminder (ownership checked).
 * Returns true if cancelled, false if not found or not owned.
 */
export async function cancelReminder(
  db: Database,
  farmId: string,
  reminderId: string,
): Promise<boolean> {
  const result = await db
    .update(reminders)
    .set({
      status: "cancelled",
      updatedAt: sql`now()`,
    })
    .where(and(eq(reminders.id, reminderId), eq(reminders.farmId, farmId)))
    .returning({ id: reminders.id });

  return result.length > 0;
}

/**
 * Generate gap reminders for a farm.
 * Creates reminders for confirmed events with missing_fields, at least 1 day old.
 * Idempotent via unique constraint.
 */
export async function generateGapReminders(
  db: Database,
  farmId: string,
  currentDate: string,
): Promise<number> {
  // Calculate one day ago
  const currentDateObj = new Date(currentDate + "T00:00:00Z");
  const oneDayAgo = new Date(currentDateObj);
  oneDayAgo.setUTCDate(oneDayAgo.getUTCDate() - 1);

  const gapEvents = await db
    .select({
      id: farmEvents.id,
      activity: farmEvents.activity,
      fieldName: farmEvents.fieldName,
      crop: farmEvents.crop,
      eventDate: farmEvents.eventDate,
      missingFields: farmEvents.missingFields,
    })
    .from(farmEvents)
    .where(
      and(
        eq(farmEvents.farmId, farmId),
        eq(farmEvents.status, "confirmed"),
        sql`array_length(${farmEvents.missingFields}, 1) > 0`,
        lte(farmEvents.createdAt, oneDayAgo),
        isNull(farmEvents.deletedAt),
      ),
    );

  if (gapEvents.length === 0) {
    return 0;
  }

  // Get existing gap reminders for these events
  const eventIds = gapEvents.map((e) => e.id);
  const existingGapReminders = await db
    .select({ sourceEventId: reminders.sourceEventId })
    .from(reminders)
    .where(
      and(
        eq(reminders.farmId, farmId),
        eq(reminders.reminderKind, "gap"),
        inArray(reminders.sourceEventId, eventIds),
      ),
    );

  const existingEventIds = new Set(
    existingGapReminders
      .map((r) => r.sourceEventId)
      .filter((id): id is string => id !== null),
  );

  // Only create reminders for events that don't have gap reminders yet
  let created = 0;
  for (const event of gapEvents) {
    if (!existingEventIds.has(event.id)) {
      await createReminder(db, farmId, {
        sourceEventId: event.id,
        reminderDate: currentDate,
        activity: event.activity,
        fieldName: event.fieldName,
        crop: event.crop,
        message: null,
        reminderKind: "gap",
      });
      created++;
    }
  }

  return created;
}

// ─── Delivery Repository Functions ───────────────────────────────────────────

/**
 * Mark a reminder as having no contact method available.
 * Sets carrier_status="no_contact_method" and increments delivery_attempts.
 * Leaves status as "pending" — this is not a permanent failure.
 */
export async function markNoContactMethod(
  db: Database,
  reminderId: string,
): Promise<void> {
  await db
    .update(reminders)
    .set({
      carrierStatus: "no_contact_method",
      carrierStatusAt: sql`now()`,
      deliveryAttempts: sql`${reminders.deliveryAttempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(reminders.id, reminderId));
}

/**
 * Get the phone number for a farm, or null if not set.
 */
export async function getFarmPhoneNumber(
  db: Database,
  farmId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ phoneNumber: farms.phoneNumber })
    .from(farms)
    .where(eq(farms.id, farmId))
    .limit(1);

  return row?.phoneNumber ?? null;
}

/**
 * Mark the farm as active now, for Tier 0 (in-app banner) delivery.
 */
export async function recordFarmActivity(
  db: Database,
  farmId: string,
): Promise<void> {
  await db
    .update(farms)
    .set({ lastActiveAt: new Date() })
    .where(eq(farms.id, farmId));
}

/**
 * Check if the farmer has been active in the app within the given window.
 * Reads farms.last_active_at and returns true if it's within `withinMinutes`.
 */
export async function isFarmerActiveInApp(
  db: Database,
  farmId: string,
  withinMinutes: number,
): Promise<boolean> {
  const [row] = await db
    .select({ lastActiveAt: farms.lastActiveAt })
    .from(farms)
    .where(eq(farms.id, farmId))
    .limit(1);

  if (!row?.lastActiveAt) return false;

  const windowMs = withinMinutes * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);
  return row.lastActiveAt >= cutoff;
}

/**
 * Get the most recent active push subscription for a farm, or null if none.
 */
export async function getPushSubscription(
  db: Database,
  farmId: string,
): Promise<PushSubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.farmId, farmId),
        eq(pushSubscriptions.active, true),
      ),
    )
    .orderBy(desc(pushSubscriptions.createdAt))
    .limit(1);

  return row ?? null;
}

/**
 * Save a push subscription for a farm.
 * Upserts on (farm_id, endpoint): if the endpoint already exists for this farm,
 * updates it to active=true; otherwise inserts a new row.
 */
export async function savePushSubscription(
  db: Database,
  farmId: string,
  subscription: {
    endpoint: string;
    keys: Record<string, string>;
    userAgent?: string | null;
  },
): Promise<void> {
  // Check if this endpoint already exists for this farm
  const [existing] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.farmId, farmId),
        eq(pushSubscriptions.endpoint, subscription.endpoint),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({
        keys: subscription.keys,
        userAgent: subscription.userAgent ?? null,
        active: true,
      })
      .where(eq(pushSubscriptions.id, existing.id));
  } else {
    await db.insert(pushSubscriptions).values({
      farmId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgent: subscription.userAgent ?? null,
      active: true,
    });
  }
}

/**
 * Record that a push notification was sent for a reminder.
 * Sets delivery_method="push", carrier_status="push_sent",
 * and snoozed_until=now+2h to prevent immediate SMS fallback.
 */
export async function recordPushSent(
  db: Database,
  reminderId: string,
): Promise<void> {
  const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await db
    .update(reminders)
    .set({
      deliveryMethod: "push",
      carrierStatus: "push_sent",
      carrierStatusAt: sql`now()`,
      snoozedUntil: twoHoursFromNow,
      updatedAt: sql`now()`,
    })
    .where(eq(reminders.id, reminderId));
}

/**
 * Store the Twilio MessageSid after a successful SMS send.
 * Sets delivery_method="sms" and carrier_status="sent".
 * Does NOT change `status` — that only changes when Twilio confirms delivery.
 */
export async function recordTwilioSid(
  db: Database,
  reminderId: string,
  sid: string,
): Promise<void> {
  await db
    .update(reminders)
    .set({
      twilioMessageSid: sid,
      deliveryMethod: "sms",
      carrierStatus: "sent",
      carrierStatusAt: sql`now()`,
      deliveryAttempts: sql`${reminders.deliveryAttempts} + 1`,
      lastDeliveredAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(reminders.id, reminderId));
}

/**
 * Update carrier status from a Twilio webhook callback.
 * - "delivered" → sets status="delivered" and carrier_status="delivered"
 * - "failed" or "undelivered" → reverts status="pending", sets carrier_status
 * - Other values → only updates carrier_status (no status change)
 */
export async function updateCarrierStatus(
  db: Database,
  reminderId: string,
  twilioStatus: string,
): Promise<void> {
  if (twilioStatus === "delivered") {
    await db
      .update(reminders)
      .set({
        status: "delivered",
        carrierStatus: "delivered",
        carrierStatusAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(reminders.id, reminderId));
  } else if (twilioStatus === "failed" || twilioStatus === "undelivered") {
    await db
      .update(reminders)
      .set({
        status: "pending",
        carrierStatus: twilioStatus,
        carrierStatusAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(reminders.id, reminderId));
  } else {
    await db
      .update(reminders)
      .set({
        carrierStatus: twilioStatus,
        carrierStatusAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(reminders.id, reminderId));
  }
}

/**
 * Acknowledge a reminder via an inbound SMS reply ("DONE").
 * Finds the most recent unacknowledged reminder for the farm owning that phone
 * number and marks it as acknowledged.
 */
export async function acknowledgeReminderBySmsFrom(
  db: Database,
  phoneNumber: string,
): Promise<void> {
  // Find the farm with this phone number
  const [farm] = await db
    .select({ id: farms.id })
    .from(farms)
    .where(eq(farms.phoneNumber, phoneNumber))
    .limit(1);

  if (!farm) return;

  // Find the most recent unacknowledged reminder for this farm
  const [reminder] = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(
      and(
        eq(reminders.farmId, farm.id),
        isNull(reminders.acknowledgedAt),
        eq(reminders.status, "pending"),
      ),
    )
    .orderBy(desc(reminders.reminderDate), desc(reminders.createdAt))
    .limit(1);

  if (!reminder) return;

  await db
    .update(reminders)
    .set({
      acknowledgedAt: sql`now()`,
      status: "delivered",
      updatedAt: sql`now()`,
    })
    .where(eq(reminders.id, reminder.id));
}

/**
 * Find due reminders for a specific farm (read-only, no FOR UPDATE SKIP LOCKED).
 * Used for the in-app banner. Excludes snoozed reminders.
 */
export async function findDueRemindersForFarm(
  db: Database,
  farmId: string,
  today: string,
): Promise<Reminder[]> {
  const rows = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.farmId, farmId),
        eq(reminders.status, "pending"),
        lte(reminders.reminderDate, today),
        or(
          isNull(reminders.snoozedUntil),
          lte(reminders.snoozedUntil, new Date()),
        ),
      ),
    )
    .orderBy(reminders.reminderDate);

  return rows.map(toReminder);
}

/**
 * Acknowledge a reminder via in-app banner click.
 * Ownership-checked: only the farm that owns the reminder can acknowledge it.
 */
export async function acknowledgeReminder(
  db: Database,
  farmId: string,
  reminderId: string,
): Promise<void> {
  await db
    .update(reminders)
    .set({
      acknowledgedAt: sql`now()`,
      status: "delivered",
      updatedAt: sql`now()`,
    })
    .where(and(eq(reminders.id, reminderId), eq(reminders.farmId, farmId)));
}

/**
 * Snooze a reminder until a specific time.
 * Ownership-checked: only the farm that owns the reminder can snooze it.
 */
export async function snoozeReminder(
  db: Database,
  farmId: string,
  reminderId: string,
  until: Date,
): Promise<void> {
  await db
    .update(reminders)
    .set({
      snoozedUntil: until,
      updatedAt: sql`now()`,
    })
    .where(and(eq(reminders.id, reminderId), eq(reminders.farmId, farmId)));
}
