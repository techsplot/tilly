import { z } from "zod";

export const reminderStatusSchema = z.enum([
  "pending",
  "delivered",
  "cancelled",
]);

export const reminderKindSchema = z.enum(["manual", "gap", "suggested"]);

export type ReminderStatus = z.infer<typeof reminderStatusSchema>;
export type ReminderKind = z.infer<typeof reminderKindSchema>;

export type Reminder = {
  id: string;
  farmId: string;
  sourceEventId: string | null;
  reminderDate: string; // YYYY-MM-DD
  activity: string;
  fieldName: string | null;
  crop: string | null;
  message: string | null;
  status: ReminderStatus;
  reminderKind: ReminderKind;
  deliveryAttempts: number;
  lastDeliveredAt: Date | null;
  acknowledgedAt: Date | null;
  snoozedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class ReminderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderError";
  }
}

/**
 * Calculate a due date from a base date and natural language offset.
 * Returns YYYY-MM-DD format.
 * Throws ReminderError for invalid/past dates.
 */
export function calculateDueDate(baseDate: string, offset: string): string {
  // Validate YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    throw new ReminderError(
      `Invalid base date format, expected YYYY-MM-DD: ${baseDate}`,
    );
  }

  // Parse base date
  const dateParts = baseDate.split("-").map(Number);
  const [year, month, day] = dateParts;
  if (!year || !month || !day) {
    throw new ReminderError(`Invalid base date: ${baseDate}`);
  }

  // Validate month and day ranges
  if (month < 1 || month > 12) {
    throw new ReminderError(`Invalid month in date: ${baseDate}`);
  }
  if (day < 1 || day > 31) {
    throw new ReminderError(`Invalid day in date: ${baseDate}`);
  }

  const base = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(base.getTime())) {
    throw new ReminderError(`Invalid base date: ${baseDate}`);
  }

  // Verify the date components match (catches invalid dates like Feb 31)
  if (
    base.getUTCFullYear() !== year ||
    base.getUTCMonth() !== month - 1 ||
    base.getUTCDate() !== day
  ) {
    throw new ReminderError(`Invalid date: ${baseDate}`);
  }

  const normalized = offset.trim().toLowerCase();

  // Parse offset
  let daysToAdd = 0;

  if (normalized === "tomorrow") {
    daysToAdd = 1;
  } else if (normalized === "today") {
    daysToAdd = 0;
  } else if (normalized.match(/^in (\d+) days?$/)) {
    const match = normalized.match(/^in (\d+) days?$/);
    daysToAdd = parseInt(match![1]!, 10);
  } else if (normalized.match(/^in (\d+) weeks?$/)) {
    const match = normalized.match(/^in (\d+) weeks?$/);
    daysToAdd = parseInt(match![1]!, 10) * 7;
  } else if (normalized === "next week") {
    daysToAdd = 7;
  } else {
    throw new ReminderError(`Unsupported offset: ${offset}`);
  }

  if (daysToAdd < 0) {
    throw new ReminderError(`Cannot set reminder in the past: ${offset}`);
  }

  // Calculate due date
  const dueDate = new Date(base);
  dueDate.setUTCDate(dueDate.getUTCDate() + daysToAdd);

  // Format as YYYY-MM-DD
  const dueYear = dueDate.getUTCFullYear();
  const dueMonth = String(dueDate.getUTCMonth() + 1).padStart(2, "0");
  const dueDay = String(dueDate.getUTCDate()).padStart(2, "0");

  return `${dueYear}-${dueMonth}-${dueDay}`;
}

/**
 * Validate that a reminder can only be created from confirmed/corrected events.
 * Throws ReminderError if the event status is invalid.
 */
export function validateReminderSource(eventStatus: string): void {
  if (eventStatus !== "confirmed" && eventStatus !== "corrected") {
    throw new ReminderError(
      `Reminders can only be created from confirmed or corrected events, not ${eventStatus}`,
    );
  }
}
