import { calculateDueDate } from "../domain/reminder";
import type { Reminder } from "../domain/reminder";
import type { Database } from "../infrastructure/db/farm-event-repository";
import {
  createReminder,
  listFarmReminders,
  cancelReminder as cancelReminderRepo,
} from "../infrastructure/db/reminder-repository";

export type ScheduleReminderInput = {
  activity: string;
  when: string;
  field?: string | null;
  crop?: string | null;
  message?: string | null;
};

export type ScheduleReminderResult =
  | { status: "success"; reminder: Reminder }
  | { status: "error"; message: string };

export async function scheduleReminder(
  db: Database,
  farmId: string,
  input: ScheduleReminderInput,
  currentDate: string,
): Promise<ScheduleReminderResult> {
  try {
    // Calculate due date deterministically
    const reminderDate = calculateDueDate(currentDate, input.when);

    // Create the reminder
    const reminderId = await createReminder(db, farmId, {
      reminderDate,
      activity: input.activity,
      fieldName: input.field ?? null,
      crop: input.crop ?? null,
      message: input.message ?? null,
      reminderKind: "manual",
    });

    // Fetch the created reminder to return
    const reminders = await listFarmReminders(db, farmId);
    const reminder = reminders.find((r) => r.id === reminderId);

    if (!reminder) {
      return {
        status: "error",
        message: "Reminder was created but could not be retrieved",
      };
    }

    return { status: "success", reminder };
  } catch (error) {
    if (error instanceof Error) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: "Failed to schedule reminder" };
  }
}

export async function listUpcomingReminders(
  db: Database,
  farmId: string,
): Promise<Reminder[]> {
  return listFarmReminders(db, farmId, "pending");
}

export type CancelReminderResult =
  | { status: "success" }
  | { status: "not_found" }
  | { status: "ambiguous"; matches: Reminder[] };

export async function cancelReminderByDescription(
  db: Database,
  farmId: string,
  description: string,
): Promise<CancelReminderResult> {
  const pending = await listFarmReminders(db, farmId, "pending");

  // Try to match by activity, optionally with field/crop
  const normalized = description.toLowerCase().trim();

  const matches = pending.filter((reminder) => {
    const activity = reminder.activity.toLowerCase();
    const field = reminder.fieldName?.toLowerCase() ?? "";
    const crop = reminder.crop?.toLowerCase() ?? "";

    // Check if description contains the activity
    if (!normalized.includes(activity)) return false;

    // If field/crop are mentioned in description, they must match
    if (field && normalized.includes(field)) return true;
    if (crop && normalized.includes(crop)) return true;

    // If no field/crop mentioned in description, match by activity only
    return !field && !crop;
  });

  if (matches.length === 0) {
    return { status: "not_found" };
  }

  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }

  // Cancel the single match
  const cancelled = await cancelReminderRepo(db, farmId, matches[0]!.id);
  return cancelled ? { status: "success" } : { status: "not_found" };
}
