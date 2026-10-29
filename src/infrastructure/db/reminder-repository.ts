import { and, eq, lte, isNull, sql, inArray } from "drizzle-orm";
import type { Database } from "./farm-event-repository";
import { reminders, farmEvents, type ReminderRow } from "./schema";
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
 * Find due reminders (pending, reminder_date <= currentDate).
 * Uses FOR UPDATE SKIP LOCKED to safely claim reminders for processing.
 * Returns up to `limit` reminders.
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
